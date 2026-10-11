// Package cloudflare is a minimal client for the parts of the Cloudflare API
// that mailbox-mcp needs: resolving a domain to a zone and managing Email
// Routing rules.
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// DefaultBaseURL is the public Cloudflare API root.
const DefaultBaseURL = "https://api.cloudflare.com/client/v4"

// Client talks to the Cloudflare API using a scoped API token.
type Client struct {
	baseURL    string
	httpClient *http.Client
	token      string
}

// New returns a Client that authenticates with the given API token against the
// public Cloudflare API.
func New(token string) *Client {
	return &Client{
		baseURL:    DefaultBaseURL,
		httpClient: &http.Client{},
		token:      token,
	}
}

// newBaseURL returns a Client for the given API root. It exists for tests.
func newBaseURL(baseURL, token string, httpClient *http.Client) *Client {
	return &Client{
		baseURL:    strings.TrimSuffix(baseURL, "/"),
		httpClient: httpClient,
		token:      token,
	}
}

// Zone is a Cloudflare zone.
type Zone struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ResolveZone returns the ID of the zone with the given name. It fails if the
// zone does not exist or is not visible to the API token.
func (c *Client) ResolveZone(ctx context.Context, name string) (string, error) {
	var zones []Zone
	if err := c.get(ctx, "/zones?name="+url.QueryEscape(name), &zones); err != nil {
		return "", fmt.Errorf("resolve zone %q: %w", name, err)
	}
	if len(zones) == 0 {
		return "", fmt.Errorf("zone %q not found: check the domain and that the API token can see it", name)
	}
	return zones[0].ID, nil
}

// Matcher describes who a routing rule matches. Mailbox rules use a literal
// matcher on the "to" field.
type Matcher struct {
	Type  string `json:"type"`
	Field string `json:"field"`
	Value string `json:"value"`
}

// Action describes what a routing rule does with a matched email. Mailbox
// rules use a worker action whose value names the Email Worker.
type Action struct {
	Type  string   `json:"type"`
	Value []string `json:"value"`
}

// Rule is an Email Routing rule.
type Rule struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Enabled  bool      `json:"enabled"`
	Matchers []Matcher `json:"matchers"`
	Actions  []Action  `json:"actions"`
}

// ListRules returns all Email Routing rules of the zone.
func (c *Client) ListRules(ctx context.Context, zoneID string) ([]Rule, error) {
	var rules []Rule
	if err := c.get(ctx, "/zones/"+zoneID+"/email/routing/rules", &rules); err != nil {
		return nil, fmt.Errorf("list routing rules: %w", err)
	}
	return rules, nil
}

// CreateMailboxRule creates an Email Routing rule that routes mail for the
// given address to the named Email Worker.
func (c *Client) CreateMailboxRule(ctx context.Context, zoneID, address, worker string) (*Rule, error) {
	payload := map[string]any{
		"name":    address,
		"enabled": true,
		"matchers": []Matcher{
			{Type: "literal", Field: "to", Value: address},
		},
		"actions": []Action{
			{Type: "worker", Value: []string{worker}},
		},
	}
	var rule Rule
	if err := c.post(ctx, "/zones/"+zoneID+"/email/routing/rules", payload, &rule); err != nil {
		return nil, fmt.Errorf("create routing rule for %q: %w", address, err)
	}
	return &rule, nil
}

// DeleteRule deletes the Email Routing rule with the given ID.
func (c *Client) DeleteRule(ctx context.Context, zoneID, ruleID string) error {
	if err := c.do(ctx, http.MethodDelete, "/zones/"+zoneID+"/email/routing/rules/"+ruleID, nil, nil); err != nil {
		return fmt.Errorf("delete routing rule %s: %w", ruleID, err)
	}
	return nil
}

// apiError is an error returned by the Cloudflare API.
type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *apiError) Error() string {
	return fmt.Sprintf("cloudflare: error %d: %s", e.Code, e.Message)
}

// envelope is the standard Cloudflare API response wrapper.
type envelope struct {
	Success bool            `json:"success"`
	Errors  []*apiError     `json:"errors"`
	Result  json.RawMessage `json:"result"`
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, out)
}

func (c *Client) post(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out)
}

// do performs an API request. When body is non-nil it is sent as JSON. When
// out is non-nil the API result is decoded into it.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("%s %s: HTTP %d: unexpected response body", method, path, resp.StatusCode)
	}
	if !env.Success || len(env.Errors) > 0 || resp.StatusCode >= 400 {
		if len(env.Errors) > 0 {
			return env.Errors[0]
		}
		return fmt.Errorf("%s %s: HTTP %d", method, path, resp.StatusCode)
	}
	if out != nil && len(env.Result) > 0 {
		if err := json.Unmarshal(env.Result, out); err != nil {
			return fmt.Errorf("%s %s: decode result: %w", method, path, err)
		}
	}
	return nil
}
