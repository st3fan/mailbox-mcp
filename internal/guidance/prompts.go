package guidance

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Register adds the guidance prompts to the server.
func Register(srv *mcp.Server) {
	srv.AddPrompt(&mcp.Prompt{
		Name:        "temporary-email",
		Description: "Walk through using a fresh temporary email address: create it, use it, watch for the reply, archive what arrived.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "purpose",
				Description: "What the address will be used for, e.g. \"testing the signup form of app.example.com\". Optional.",
				Required:    false,
			},
		},
	}, temporaryEmail)

	srv.AddPrompt(&mcp.Prompt{
		Name:        "verification-code",
		Description: "Complete an email verification flow: create an address, submit it to the site, poll for the verification mail, extract the link or code.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "site",
				Description: "The site or system whose verification flow is being completed. Optional.",
				Required:    false,
			},
		},
	}, verificationCode)

	srv.AddPrompt(&mcp.Prompt{
		Name:        "mailbox-summary",
		Description: "Summarize the messages in one mailbox and suggest what could be archived, without changing anything without confirmation.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "address",
				Description: "The mailbox address to summarize, e.g. alice@mail.example.com.",
				Required:    true,
			},
		},
	}, mailboxSummary)
}

// temporaryEmail is the temporary-email prompt handler.
func temporaryEmail(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	purpose := strings.TrimSpace(req.Params.Arguments["purpose"])
	text := fmt.Sprintf(`Create a temporary email address with create_random_mailbox.
Purpose: %s.

Remember: mailbox-mcp cannot send email — the address only receives.

1. Use the new address wherever an email address is asked for.
2. After submitting, wait a moment, then poll list_messages for that address (polling is side-effect free).
3. When mail arrives, read_message the newest one and extract whatever the purpose needs (link, code, confirmation).
4. mark_message_read it once acted on.
5. If the message is no longer needed, archive_message it — prefer archiving over deleting so it stays available for reference. Only delete_message mail you are certain is disposable noise.
6. Keep the mailbox for now; only delete_mailbox when the address is truly done with and nothing in it is worth keeping.`, purposeOrInferred(purpose))

	return userPromptResult("Create and use a temporary email address", text), nil
}

// purposeOrInferred returns the purpose, or a nudge to infer it when absent.
func purposeOrInferred(purpose string) string {
	if purpose == "" {
		return "(not stated — infer it from the task at hand)"
	}
	return purpose
}

// verificationCode is the verification-code prompt handler.
func verificationCode(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	site := strings.TrimSpace(req.Params.Arguments["site"])
	if site == "" {
		site = "the target site"
	}
	text := fmt.Sprintf(`You are completing an email verification flow for %s — receiving only: the site sends the mail, you read it here.

1. Create a fresh address with create_random_mailbox and use it on the site's form.
2. Poll list_messages for that address a few times over the next minute (listing does not mark anything read).
3. When the verification email appears, read_message the newest message and extract the verification link or code.
4. Report the link or code to me, then mark_message_read the message.
5. Finish by archiving it with archive_message — archive rather than delete, so the proof of verification stays around in case it is needed again.`, site)

	return userPromptResult("Complete an email verification flow", text), nil
}

// mailboxSummary is the mailbox-summary prompt handler. Its address argument
// is required.
func mailboxSummary(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	address := strings.TrimSpace(req.Params.Arguments["address"])
	if address == "" {
		return nil, errors.New("address is required: the mailbox address to summarize")
	}
	text := fmt.Sprintf(`Summarize the mailbox %s:

1. list_messages the address and summarize each message: subject, sender, when it arrived, and what it appears to be about.
2. Note which messages are unread.
3. For messages whose content is fully handled, mark_message_read them.
4. Suggest which messages could be archived as no-longer-needed — but do not archive or delete anything without asking me first.`, address)

	return userPromptResult("Summarize a mailbox", text), nil
}

// userPromptResult wraps a prompt text as a single user message.
func userPromptResult(description, text string) *mcp.GetPromptResult {
	return &mcp.GetPromptResult{
		Description: description,
		Messages: []*mcp.PromptMessage{
			{
				Role:    mcp.Role("user"),
				Content: &mcp.TextContent{Text: text},
			},
		},
	}
}
