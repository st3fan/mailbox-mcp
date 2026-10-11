package mailboxes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/messages"
)

// fakeMessagesAPI serves canned responses and counts the requests the tool
// handlers make, so tests can assert that invalid input never reaches the API.
type fakeMessagesAPI struct {
	requests atomic.Int64
	method   atomic.Value // string
	path     atomic.Value // string
}

func newFakeMessagesAPI(t *testing.T, status int, body string) (*messages.Client, *fakeMessagesAPI) {
	return newFakeMessagesAPIFunc(t, func(*http.Request) (int, string) { return status, body })
}

// newFakeMessagesAPIFunc lets tests route responses per request, e.g. GET
// read vs POST mark-read.
func newFakeMessagesAPIFunc(t *testing.T, respond func(*http.Request) (int, string)) (*messages.Client, *fakeMessagesAPI) {
	t.Helper()
	fake := &fakeMessagesAPI{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.requests.Add(1)
		fake.method.Store(r.Method)
		fake.path.Store(r.URL.RequestURI())
		status, body := respond(r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return messages.New(server.URL, "test-token"), fake
}

func TestListMessagesTool(t *testing.T) {
	tests := []struct {
		name      string
		input     listMessagesInput
		status    int
		body      string
		wantErr   string
		wantCalls int64
		check     func(*testing.T, messageList)
	}{
		{
			name:      "valid address lists messages",
			input:     listMessagesInput{Address: "alice@outofscope.party"},
			status:    http.StatusOK,
			body:      `{"messages":[{"id":"1-a","subject":"Hi","read":false,"archived":false}],"nextPageToken":"tok"}`,
			wantCalls: 1,
			check: func(t *testing.T, out messageList) {
				if len(out.Messages) != 1 || out.Messages[0].Subject != "Hi" {
					t.Errorf("unexpected messages: %+v", out.Messages)
				}
				if out.NextPageToken != "tok" {
					t.Errorf("NextPageToken = %q, want %q", out.NextPageToken, "tok")
				}
			},
		},
		{
			name:      "address on another domain is rejected locally",
			input:     listMessagesInput{Address: "alice@elsewhere.example"},
			wantErr:   "is not a mailbox on outofscope.party",
			wantCalls: 0,
		},
		{
			name:      "empty address is rejected locally",
			input:     listMessagesInput{Address: "  "},
			wantErr:   "address is required",
			wantCalls: 0,
		},
	}
	domain := "outofscope.party"

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, fake := newFakeMessagesAPI(t, tt.status, tt.body)
			handler := listMessages(client, domain)

			_, out, err := handler(context.Background(), &mcp.CallToolRequest{}, tt.input)

			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want it to contain %q", err, tt.wantErr)
				}
			} else if err != nil {
				t.Fatalf("error = %v, want nil", err)
			}
			if got := fake.requests.Load(); got != tt.wantCalls {
				t.Errorf("api calls = %d, want %d", got, tt.wantCalls)
			}
			if tt.check != nil {
				tt.check(t, out)
			}
		})
	}
}

func TestMessageTools(t *testing.T) {
	domain := "outofscope.party"
	ctx := context.Background()

	t.Run("read_message returns metadata and raw content and marks read", func(t *testing.T) {
		client, fake := newFakeMessagesAPIFunc(t, func(r *http.Request) (int, string) {
			if r.Method == http.MethodGet {
				return http.StatusOK, `{"message":{"id":"1-a","subject":"Hi","read":false},"raw":"raw body"}`
			}
			return http.StatusOK, `{"message":{"id":"1-a","subject":"Hi","read":true}}`
		})
		handler := readMessage(client, domain)

		_, out, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: "1-a",
		})
		if err != nil {
			t.Fatalf("error = %v, want nil", err)
		}
		if out.Raw != "raw body" || out.Message.Subject != "Hi" {
			t.Errorf("unexpected output: %+v", out)
		}
		if !out.Message.Read {
			t.Errorf("Read = false, want the post-mark state")
		}
		if got := fake.requests.Load(); got != 2 {
			t.Errorf("api calls = %d, want 2 (read + mark read)", got)
		}
		if got := fake.method.Load().(string); got != http.MethodPost {
			t.Errorf("last request method = %q, want POST (the mark)", got)
		}
	})

	t.Run("read_message surfaces a failed mark", func(t *testing.T) {
		client, _ := newFakeMessagesAPIFunc(t, func(r *http.Request) (int, string) {
			if r.Method == http.MethodGet {
				return http.StatusOK, `{"message":{"id":"1-a","read":false},"raw":"raw body"}`
			}
			return http.StatusInternalServerError, `{"error":"storage down"}`
		})
		handler := readMessage(client, domain)

		_, _, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: "1-a",
		})
		if err == nil || !strings.Contains(err.Error(), "marking it read failed") {
			t.Fatalf("error = %v, want the mark-failed error", err)
		}
	})

	t.Run("read_message requires an id", func(t *testing.T) {
		client, fake := newFakeMessagesAPI(t, http.StatusOK, `{}`)
		handler := readMessage(client, domain)

		_, _, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: " ",
		})
		if err == nil || !strings.Contains(err.Error(), "id is required") {
			t.Fatalf("error = %v, want id required", err)
		}
		if got := fake.requests.Load(); got != 0 {
			t.Errorf("api calls = %d, want 0", got)
		}
	})

	t.Run("mark_message_read posts to the read endpoint", func(t *testing.T) {
		client, fake := newFakeMessagesAPI(t, http.StatusOK, `{"message":{"id":"1-a","read":true}}`)
		handler := flagMessage(client, domain, "read")

		_, out, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: "1-a",
		})
		if err != nil {
			t.Fatalf("error = %v, want nil", err)
		}
		if !out.Read {
			t.Errorf("Read = false, want true")
		}
		if got := fake.method.Load().(string); got != http.MethodPost {
			t.Errorf("method = %q, want POST", got)
		}
		if got := fake.path.Load().(string); got != "/mailboxes/alice@outofscope.party/messages/1-a/read" {
			t.Errorf("path = %q", got)
		}
	})

	t.Run("archive_message posts to the archive endpoint", func(t *testing.T) {
		client, fake := newFakeMessagesAPI(t, http.StatusOK, `{"message":{"id":"1-a","archived":true}}`)
		handler := flagMessage(client, domain, "archive")

		_, out, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: "1-a",
		})
		if err != nil {
			t.Fatalf("error = %v, want nil", err)
		}
		if !out.Archived {
			t.Errorf("Archived = false, want true")
		}
		if got := fake.path.Load().(string); got != "/mailboxes/alice@outofscope.party/messages/1-a/archive" {
			t.Errorf("path = %q", got)
		}
	})

	t.Run("delete_message deletes and reports it", func(t *testing.T) {
		client, fake := newFakeMessagesAPI(t, http.StatusOK, `{"deleted":true}`)
		handler := deleteMessage(client, domain)

		_, out, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: "1-a",
		})
		if err != nil {
			t.Fatalf("error = %v, want nil", err)
		}
		if !out.Deleted {
			t.Errorf("Deleted = false, want true")
		}
		if got := fake.method.Load().(string); got != http.MethodDelete {
			t.Errorf("method = %q, want DELETE", got)
		}
	})

	t.Run("a not-found message surfaces the API error", func(t *testing.T) {
		client, _ := newFakeMessagesAPI(t, http.StatusNotFound, `{"error":"not found"}`)
		handler := readMessage(client, domain)

		_, _, err := handler(ctx, &mcp.CallToolRequest{}, messageInput{
			Address: "alice@outofscope.party", ID: "9-z",
		})
		if err == nil || !strings.Contains(err.Error(), "not found") {
			t.Fatalf("error = %v, want not found", err)
		}
	})
}
