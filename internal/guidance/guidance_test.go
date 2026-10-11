package guidance

import (
	"context"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestInstructionsContent(t *testing.T) {
	// The guidance points agents learn the server from; make sure they
	// survive edits.
	for _, part := range []string{
		"temporary email",
		"cannot send email",
		"create_random_mailbox",
		"list_messages",
		"read_message",
		"marks the message as read",
		"mark_message_read",
		"Prefer archiving over deleting",
		"archive_message",
		"delete_message",
		"delete_mailbox",
		"rejected locally",
	} {
		if !strings.Contains(Instructions, part) {
			t.Errorf("Instructions missing %q", part)
		}
	}
}

func callPrompt(t *testing.T, handler mcp.PromptHandler, args map[string]string) (string, error) {
	t.Helper()
	result, err := handler(context.Background(), &mcp.GetPromptRequest{
		Params: &mcp.GetPromptParams{Name: "test", Arguments: args},
	})
	if err != nil {
		return "", err
	}
	if len(result.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(result.Messages))
	}
	text, ok := result.Messages[0].Content.(*mcp.TextContent)
	if !ok {
		t.Fatalf("content = %T, want *mcp.TextContent", result.Messages[0].Content)
	}
	return text.Text, nil
}

func TestTemporaryEmailPrompt(t *testing.T) {
	handler := mcp.PromptHandler(temporaryEmail)

	text, err := callPrompt(t, handler, map[string]string{
		"purpose": "testing the signup form of app.example.com",
	})
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	for _, part := range []string{
		"testing the signup form of app.example.com",
		"create_random_mailbox",
		"cannot send email",
		"list_messages",
		"read_message the newest",
		"archive_message",
		"prefer archiving over deleting",
		"delete_mailbox",
	} {
		if !strings.Contains(text, part) {
			t.Errorf("prompt text missing %q", part)
		}
	}

	// Without a purpose the prompt still works and nudges the agent.
	text, err = callPrompt(t, handler, nil)
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	if !strings.Contains(text, "infer it from the task at hand") {
		t.Errorf("prompt text = %q, want the infer-purpose nudge", text)
	}
}

func TestVerificationCodePrompt(t *testing.T) {
	handler := mcp.PromptHandler(verificationCode)

	text, err := callPrompt(t, handler, map[string]string{"site": "app.example.com"})
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	for _, part := range []string{
		"app.example.com",
		"receiving only",
		"create_random_mailbox",
		"list_messages",
		"verification link or code",
		"marked it as read",
		"archive_message",
		"archive rather than delete",
	} {
		if !strings.Contains(text, part) {
			t.Errorf("prompt text missing %q", part)
		}
	}

	// Without a site the prompt falls back to a generic subject.
	text, err = callPrompt(t, handler, nil)
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	if !strings.Contains(text, "the target site") {
		t.Errorf("prompt text = %q, want the generic site fallback", text)
	}
}

func TestMailboxSummaryPrompt(t *testing.T) {
	handler := mcp.PromptHandler(mailboxSummary)

	text, err := callPrompt(t, handler, map[string]string{
		"address": "alice@outofscope.party",
	})
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	for _, part := range []string{
		"alice@outofscope.party",
		"list_messages",
		"unread",
		"mark_message_read",
		"archived",
		"without asking me first",
	} {
		if !strings.Contains(text, part) {
			t.Errorf("prompt text missing %q", part)
		}
	}

	// The address argument is required.
	if _, err := callPrompt(t, handler, nil); err == nil || !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("error = %v, want address required", err)
	}
}
