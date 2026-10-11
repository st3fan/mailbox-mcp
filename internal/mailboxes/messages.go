// Message tools: reading the mailbox and managing its messages, backed by the
// messages API worker (see PRODUCT.md and internal/messages). They live in the
// mailboxes package because they share its address validation and registration
// conventions.

package mailboxes

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/messages"
)

// registerMessages wires the message tools onto the server. The address
// validation runs locally, before any API call, exactly like the mailbox
// tools: only addresses on the configured domain are accepted.
func RegisterMessages(srv *mcp.Server, client *messages.Client, domain string) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_messages",
		Description: fmt.Sprintf("List the messages of a mailbox on %s, newest first. Returns metadata and a page token for the next page.", domain),
	}, listMessages(client, domain))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "read_message",
		Description: fmt.Sprintf("Read one message of a mailbox on %s: its metadata and raw content.", domain),
	}, readMessage(client, domain))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "mark_message_read",
		Description: fmt.Sprintf("Mark a message of a mailbox on %s as read.", domain),
	}, flagMessage(client, domain, "read"))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "archive_message",
		Description: fmt.Sprintf("Archive a message of a mailbox on %s.", domain),
	}, flagMessage(client, domain, "archive"))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "delete_message",
		Description: fmt.Sprintf("Delete a message of a mailbox on %s.", domain),
	}, deleteMessage(client, domain))
}

// listMessagesInput is the input of the list_messages tool.
type listMessagesInput struct {
	// Address is the full mailbox address, for example "alice@mail.example.com".
	Address string `json:"address" jsonschema:"the mailbox address to list messages for"`
	// PageToken resumes a previous listing; from the nextPageToken of the last result.
	PageToken string `json:"pageToken,omitempty" jsonschema:"page token from a previous list_messages result, to get the next page"`
}

// messageList is the output of the list_messages tool.
type messageList struct {
	Messages      []messages.Message `json:"messages"`
	NextPageToken string             `json:"nextPageToken,omitempty"`
}

func listMessages(client *messages.Client, domain string) mcp.ToolHandlerFor[listMessagesInput, messageList] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input listMessagesInput) (*mcp.CallToolResult, messageList, error) {
		address := strings.TrimSpace(input.Address)
		if err := validateAddress(address, domain); err != nil {
			return nil, messageList{}, err
		}
		page, err := client.ListMessages(ctx, address, input.PageToken)
		if err != nil {
			return nil, messageList{}, err
		}
		return nil, messageList{Messages: page.Messages, NextPageToken: page.NextPageToken}, nil
	}
}

// messageInput is the input of the tools that address one message.
type messageInput struct {
	// Address is the full mailbox address the message belongs to.
	Address string `json:"address" jsonschema:"the mailbox address the message belongs to"`
	// ID is the message id, from a list_messages result.
	ID string `json:"id" jsonschema:"the message id, from a list_messages result"`
}

// readMessage returns the message's metadata and raw content and marks the
// message as read in the same call: reading a message means having seen it,
// so agents do not need a separate mark step. The returned metadata reflects
// the post-mark state. If marking fails after a successful read, the error is
// surfaced; the agent can simply retry.
func readMessage(client *messages.Client, domain string) mcp.ToolHandlerFor[messageInput, messages.StoredMessage] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input messageInput) (*mcp.CallToolResult, messages.StoredMessage, error) {
		address, id, err := validateMessageInput(input, domain)
		if err != nil {
			return nil, messages.StoredMessage{}, err
		}
		stored, err := client.GetMessage(ctx, address, id)
		if err != nil {
			return nil, messages.StoredMessage{}, err
		}
		read, err := client.MarkRead(ctx, address, id)
		if err != nil {
			return nil, messages.StoredMessage{}, fmt.Errorf("message read, but marking it read failed (retry to mark it): %w", err)
		}
		stored.Message = *read
		return nil, *stored, nil
	}
}

// flagMessage is the shared handler of mark_message_read and archive_message.
// action is "read" or "archive", the messages API's flag endpoint name.
func flagMessage(client *messages.Client, domain, action string) mcp.ToolHandlerFor[messageInput, messages.Message] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input messageInput) (*mcp.CallToolResult, messages.Message, error) {
		address, id, err := validateMessageInput(input, domain)
		if err != nil {
			return nil, messages.Message{}, err
		}
		var updated *messages.Message
		switch action {
		case "read":
			updated, err = client.MarkRead(ctx, address, id)
		case "archive":
			updated, err = client.Archive(ctx, address, id)
		default:
			err = fmt.Errorf("unknown action %q", action)
		}
		if err != nil {
			return nil, messages.Message{}, err
		}
		return nil, *updated, nil
	}
}

// deletedMessage is the output of the delete_message tool.
type deletedMessage struct {
	Deleted bool `json:"deleted"`
}

func deleteMessage(client *messages.Client, domain string) mcp.ToolHandlerFor[messageInput, deletedMessage] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input messageInput) (*mcp.CallToolResult, deletedMessage, error) {
		address, id, err := validateMessageInput(input, domain)
		if err != nil {
			return nil, deletedMessage{}, err
		}
		if err := client.DeleteMessage(ctx, address, id); err != nil {
			return nil, deletedMessage{}, err
		}
		return nil, deletedMessage{Deleted: true}, nil
	}
}

// validateMessageInput validates a message-scoped tool input: the address
// must be a mailbox on the configured domain, the id must be present.
func validateMessageInput(input messageInput, domain string) (string, string, error) {
	address := strings.TrimSpace(input.Address)
	if err := validateAddress(address, domain); err != nil {
		return "", "", err
	}
	id := strings.TrimSpace(input.ID)
	if id == "" {
		return "", "", errors.New("id is required")
	}
	return address, id, nil
}
