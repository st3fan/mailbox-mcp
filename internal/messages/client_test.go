package messages

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestClient starts an httptest server that records the last request and
// replies with the given body, and returns a client pointed at it.
func newTestClient(t *testing.T, status int, body string) (*Client, *recordedRequest) {
	t.Helper()
	rec := &recordedRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.method = r.Method
		rec.path = r.URL.RequestURI()
		rec.authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return newClient(server.URL, "test-token", server.Client()), rec
}

type recordedRequest struct {
	method        string
	path          string
	authorization string
}

func TestClientRequests(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		call       func(c *Client) error
		wantMethod string
		wantPath   string
	}{
		{
			name:   "list messages from the start",
			status: http.StatusOK,
			body:   `{"messages":[{"id":"1-a","mailbox":"alice@outofscope.party","from":"s@x","to":"alice@outofscope.party","subject":"Hi","receivedAt":"2026-01-01T00:00:00.000Z","size":12,"read":false,"archived":false}],"nextPageToken":null}`,
			call: func(c *Client) error {
				page, err := c.ListMessages(context.Background(), "alice@outofscope.party", "")
				if err != nil {
					return err
				}
				if len(page.Messages) != 1 || page.Messages[0].ID != "1-a" || page.Messages[0].Read {
					t.Errorf("unexpected page: %+v", page)
				}
				if page.NextPageToken != "" {
					t.Errorf("NextPageToken = %q, want empty", page.NextPageToken)
				}
				return nil
			},
			wantMethod: http.MethodGet,
			wantPath:   "/mailboxes/alice@outofscope.party/messages",
		},
		{
			name:   "list messages with a page token",
			status: http.StatusOK,
			body:   `{"messages":[],"nextPageToken":"cursor:10"}`,
			call: func(c *Client) error {
				page, err := c.ListMessages(context.Background(), "alice@outofscope.party", "tok/en 1")
				if err != nil {
					return err
				}
				if page.NextPageToken != "cursor:10" {
					t.Errorf("NextPageToken = %q, want %q", page.NextPageToken, "cursor:10")
				}
				return nil
			},
			wantMethod: http.MethodGet,
			wantPath:   "/mailboxes/alice@outofscope.party/messages?cursor=tok%2Fen+1",
		},
		{
			name:   "get message",
			status: http.StatusOK,
			body:   `{"message":{"id":"1-a","mailbox":"alice@outofscope.party","subject":"Hi","size":8,"read":false,"archived":false},"raw":"raw body"}`,
			call: func(c *Client) error {
				stored, err := c.GetMessage(context.Background(), "alice@outofscope.party", "1-a")
				if err != nil {
					return err
				}
				if stored.Raw != "raw body" || stored.Message.Subject != "Hi" {
					t.Errorf("unexpected stored message: %+v", stored)
				}
				return nil
			},
			wantMethod: http.MethodGet,
			wantPath:   "/mailboxes/alice@outofscope.party/messages/1-a",
		},
		{
			name:       "mark read",
			status:     http.StatusOK,
			body:       `{"message":{"id":"1-a","read":true,"archived":false}}`,
			wantMethod: http.MethodPost,
			wantPath:   "/mailboxes/alice@outofscope.party/messages/1-a/read",
			call: func(c *Client) error {
				msg, err := c.MarkRead(context.Background(), "alice@outofscope.party", "1-a")
				if err != nil {
					return err
				}
				if !msg.Read || msg.Archived {
					t.Errorf("unexpected flags: %+v", msg)
				}
				return nil
			},
		},
		{
			name:       "archive",
			status:     http.StatusOK,
			body:       `{"message":{"id":"1-a","read":true,"archived":true}}`,
			wantMethod: http.MethodPost,
			wantPath:   "/mailboxes/alice@outofscope.party/messages/1-a/archive",
			call: func(c *Client) error {
				msg, err := c.Archive(context.Background(), "alice@outofscope.party", "1-a")
				if err != nil {
					return err
				}
				if !msg.Archived {
					t.Errorf("unexpected flags: %+v", msg)
				}
				return nil
			},
		},
		{
			name:       "delete message",
			status:     http.StatusOK,
			body:       `{"deleted":true}`,
			wantMethod: http.MethodDelete,
			wantPath:   "/mailboxes/alice@outofscope.party/messages/1-a",
			call: func(c *Client) error {
				return c.DeleteMessage(context.Background(), "alice@outofscope.party", "1-a")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, rec := newTestClient(t, tt.status, tt.body)
			if err := tt.call(client); err != nil {
				t.Fatalf("call error = %v, want nil", err)
			}
			if rec.method != tt.wantMethod {
				t.Errorf("method = %q, want %q", rec.method, tt.wantMethod)
			}
			if rec.path != tt.wantPath {
				t.Errorf("path = %q, want %q", rec.path, tt.wantPath)
			}
			if rec.authorization != "Bearer test-token" {
				t.Errorf("authorization = %q, want bearer token", rec.authorization)
			}
		})
	}
}

func TestClientErrors(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		body      string
		wantParts []string
	}{
		{
			name:      "unauthorized",
			status:    http.StatusUnauthorized,
			body:      `{"error":"unauthorized"}`,
			wantParts: []string{"401", "unauthorized"},
		},
		{
			name:      "not found",
			status:    http.StatusNotFound,
			body:      `{"error":"not found"}`,
			wantParts: []string{"404", "not found"},
		},
		{
			name:      "server error without a JSON body",
			status:    http.StatusInternalServerError,
			body:      "boom",
			wantParts: []string{"500", "GET /mailboxes/alice@outofscope.party/messages"},
		},
		{
			name:      "undecodable success body",
			status:    http.StatusOK,
			body:      "{not json",
			wantParts: []string{"decode response"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, _ := newTestClient(t, tt.status, tt.body)
			_, err := client.ListMessages(context.Background(), "alice@outofscope.party", "")
			if err == nil {
				t.Fatalf("ListMessages error = nil, want error")
			}
			for _, part := range tt.wantParts {
				if !strings.Contains(err.Error(), part) {
					t.Errorf("error = %q, want it to contain %q", err.Error(), part)
				}
			}
		})
	}
}

func TestErrorType(t *testing.T) {
	client, _ := newTestClient(t, http.StatusNotFound, `{"error":"not found"}`)
	_, err := client.GetMessage(context.Background(), "alice@outofscope.party", "9-z")
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %T, want *Error in the chain", err)
	}
	if apiErr.Status != http.StatusNotFound || apiErr.Message != "not found" {
		t.Errorf("Error = %+v, want status 404 and message %q", apiErr, "not found")
	}
}
