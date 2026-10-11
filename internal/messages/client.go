// Package messages is a minimal client for the mailbox-mcp messages API: the
// Cloudflare Worker (workers/messages-api) that serves the mail the email
// worker stores in R2. The API is authenticated with a bearer token and every
// operation is scoped to one mailbox address.
package messages

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Client talks to the messages API using its bearer token.
type Client struct {
	baseURL    string
	httpClient *http.Client
	token      string
}

// New returns a Client for the messages API at the given base URL, for example
// "https://messages.example.com". The URL is used as given; a trailing slash
// is ignored.
func New(baseURL, token string) *Client {
	return newClient(baseURL, token, &http.Client{})
}

// newClient returns a Client with an explicit HTTP client. It exists for tests.
func newClient(baseURL, token string, httpClient *http.Client) *Client {
	return &Client{
		baseURL:    strings.TrimSuffix(baseURL, "/"),
		httpClient: httpClient,
		token:      token,
	}
}

// Message is a message's metadata as served by the API. It is what list
// results contain and what read/flag operations return alongside the raw
// content.
type Message struct {
	// ID is the message id used in API paths.
	ID string `json:"id"`
	// Mailbox is the mailbox address the message was sent to.
	Mailbox string `json:"mailbox"`
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	// ReceivedAt is the receive time as an RFC 3339 UTC timestamp.
	ReceivedAt string `json:"receivedAt"`
	// Size is the raw message size in bytes.
	Size     int64 `json:"size"`
	Read     bool  `json:"read"`
	Archived bool  `json:"archived"`
}

// MessagePage is one page of a mailbox listing.
type MessagePage struct {
	// Messages is the page's messages, newest first.
	Messages []Message `json:"messages"`
	// NextPageToken resumes the listing; empty when the mailbox is exhausted.
	NextPageToken string `json:"nextPageToken"`
}

// StoredMessage is a message's metadata plus its raw content.
type StoredMessage struct {
	Message Message `json:"message"`
	Raw     string  `json:"raw"`
}

// ListMessages returns one page of the mailbox's messages, newest first. When
// pageToken is empty the listing starts at the newest message; otherwise it
// resumes after the page the token was returned with.
func (c *Client) ListMessages(ctx context.Context, address, pageToken string) (*MessagePage, error) {
	path := "/mailboxes/" + url.PathEscape(address) + "/messages"
	if pageToken != "" {
		path += "?cursor=" + url.QueryEscape(pageToken)
	}
	var page MessagePage
	if err := c.do(ctx, http.MethodGet, path, &page); err != nil {
		return nil, fmt.Errorf("list messages of %q: %w", address, err)
	}
	return &page, nil
}

// GetMessage returns one message's metadata and raw content.
func (c *Client) GetMessage(ctx context.Context, address, id string) (*StoredMessage, error) {
	var stored StoredMessage
	if err := c.do(ctx, http.MethodGet, messagePath(address, id), &stored); err != nil {
		return nil, fmt.Errorf("get message %q of %q: %w", id, address, err)
	}
	return &stored, nil
}

// MarkRead marks the message as read and returns the updated metadata.
func (c *Client) MarkRead(ctx context.Context, address, id string) (*Message, error) {
	return c.flag(ctx, address, id, "read")
}

// Archive archives the message and returns the updated metadata.
func (c *Client) Archive(ctx context.Context, address, id string) (*Message, error) {
	return c.flag(ctx, address, id, "archive")
}

func (c *Client) flag(ctx context.Context, address, id, action string) (*Message, error) {
	var body struct {
		Message Message `json:"message"`
	}
	if err := c.do(ctx, http.MethodPost, messagePath(address, id)+"/"+action, &body); err != nil {
		return nil, fmt.Errorf("%s message %q of %q: %w", action, id, address, err)
	}
	return &body.Message, nil
}

// DeleteMessage deletes the message: its raw content and metadata.
func (c *Client) DeleteMessage(ctx context.Context, address, id string) error {
	if err := c.do(ctx, http.MethodDelete, messagePath(address, id), nil); err != nil {
		return fmt.Errorf("delete message %q of %q: %w", id, address, err)
	}
	return nil
}

func messagePath(address, id string) string {
	return "/mailboxes/" + url.PathEscape(address) + "/messages/" + url.PathEscape(id)
}

// Error is an error response from the messages API.
type Error struct {
	// Status is the HTTP status code.
	Status int
	// Method and Path identify the failed request.
	Method string
	Path   string
	// Message is the API's error message, empty when it sent none.
	Message string
}

func (e *Error) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("messages api: %s %s: HTTP %d", e.Method, e.Path, e.Status)
	}
	return fmt.Sprintf("messages api: %s %s: HTTP %d: %s", e.Method, e.Path, e.Status, e.Message)
}

// do performs an API request. When out is non-nil the response body is decoded
// into it. Non-2xx responses become *Error.
func (c *Client) do(ctx context.Context, method, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("%s %s: read response: %w", method, path, err)
	}

	if resp.StatusCode >= 400 {
		var body struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &body)
		return &Error{Status: resp.StatusCode, Method: method, Path: path, Message: body.Error}
	}

	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("%s %s: decode response: %w", method, path, err)
		}
	}
	return nil
}
