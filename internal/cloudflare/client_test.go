package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// newTestClient starts an httptest server that routes every request through
// the given handler and returns a client pointed at it.
func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return newBaseURL(server.URL, "test-token", server.Client())
}

// envelopeJSON renders a successful Cloudflare API envelope around result.
func envelopeJSON(t *testing.T, result any) []byte {
	t.Helper()
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	return []byte(`{"success":true,"errors":[],"result":` + string(raw) + `}`)
}

func TestResolveZone(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		wantID  string
		wantErr string
	}{
		{
			name: "found",
			handler: func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/zones" || r.URL.Query().Get("name") != "mail.example.com" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
				}
				if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
					t.Errorf("Authorization = %q, want bearer token", got)
				}
				w.Header().Set("Content-Type", "application/json")
				w.Write(envelopeJSON(t, []Zone{{ID: "zone-1", Name: "mail.example.com"}}))
			},
			wantID: "zone-1",
		},
		{
			name: "not found",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Write(envelopeJSON(t, []Zone{}))
			},
			wantErr: "zone \"mail.example.com\" not found",
		},
		{
			name: "api error",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				w.Write([]byte(`{"success":false,"errors":[{"code":9109,"message":"Unauthorized"}],"result":null}`))
			},
			wantErr: "error 9109: Unauthorized",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := newTestClient(t, tt.handler)
			got, err := client.ResolveZone(context.Background(), "mail.example.com")
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("ResolveZone() = %q, want error containing %q", got, tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("ResolveZone() error = %q, want it to contain %q", err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveZone() error = %v, want nil", err)
			}
			if got != tt.wantID {
				t.Errorf("ResolveZone() = %q, want %q", got, tt.wantID)
			}
		})
	}
}
func TestListRules(t *testing.T) {
	want := []Rule{
		{
			ID:       "rule-1",
			Name:     "alice@mail.example.com",
			Enabled:  true,
			Matchers: []Matcher{{Type: "literal", Field: "to", Value: "alice@mail.example.com"}},
			Actions:  []Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
		},
	}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/zones/zone-1/email/routing/rules" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(envelopeJSON(t, want))
	})

	got, err := client.ListRules(context.Background(), "zone-1")
	if err != nil {
		t.Fatalf("ListRules() error = %v, want nil", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ListRules() = %+v, want %+v", got, want)
	}
}

func TestCreateMailboxRule(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/zones/zone-1/email/routing/rules" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
		}
		var payload struct {
			Name     string    `json:"name"`
			Enabled  bool      `json:"enabled"`
			Matchers []Matcher `json:"matchers"`
			Actions  []Action  `json:"actions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if payload.Name != "alice@mail.example.com" || !payload.Enabled {
			t.Errorf("payload = %+v, want name/address and enabled", payload)
		}
		if len(payload.Matchers) != 1 {
			t.Fatalf("matchers = %+v, want one literal matcher", payload.Matchers)
		}
		m := payload.Matchers[0]
		if m.Type != "literal" || m.Field != "to" || m.Value != "alice@mail.example.com" {
			t.Errorf("matcher = %+v, want literal to matcher", m)
		}
		if len(payload.Actions) != 1 {
			t.Fatalf("actions = %+v, want one worker action", payload.Actions)
		}
		a := payload.Actions[0]
		if a.Type != "worker" || len(a.Value) != 1 || a.Value[0] != "mailbox-mcp-email-worker" {
			t.Errorf("action = %+v, want worker action for mailbox-mcp-email-worker", a)
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(envelopeJSON(t, Rule{ID: "rule-1", Name: "alice@mail.example.com", Enabled: true}))
	})

	got, err := client.CreateMailboxRule(context.Background(), "zone-1", "alice@mail.example.com", "mailbox-mcp-email-worker")
	if err != nil {
		t.Fatalf("CreateMailboxRule() error = %v, want nil", err)
	}
	if got.ID != "rule-1" || !got.Enabled {
		t.Errorf("CreateMailboxRule() = %+v, want created rule", got)
	}
}

func TestDeleteRule(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		wantErr string
	}{
		{
			name:   "success",
			status: http.StatusOK,
			body:   `{"success":true,"errors":[],"result":{}}`,
		},
		{
			name:    "unknown rule",
			status:  http.StatusNotFound,
			body:    `{"success":false,"errors":[{"code":404,"message":"routing rule not found"}],"result":null}`,
			wantErr: "error 404: routing rule not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodDelete || r.URL.Path != "/zones/zone-1/email/routing/rules/rule-1" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.status)
				w.Write([]byte(tt.body))
			})

			err := client.DeleteRule(context.Background(), "zone-1", "rule-1")
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("DeleteRule() error = %v, want nil", err)
				}
				return
			}
			if err == nil {
				t.Fatal("DeleteRule() = nil, want error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("DeleteRule() error = %q, want it to contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestNonJSONResponse(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte("upstream error"))
	})
	_, err := client.ResolveZone(context.Background(), "mail.example.com")
	if err == nil {
		t.Fatal("ResolveZone() = nil error, want error for non-JSON body")
	}
	if !strings.Contains(err.Error(), "HTTP 502") {
		t.Errorf("error = %q, want it to mention HTTP 502", err.Error())
	}
}

func TestUpdateRuleStatus(t *testing.T) {
	// The existing rule on the fake API, as GET returns it.
	existingRule := Rule{
		ID:       "rule-1",
		Name:     "ada@mail.example.com",
		Enabled:  true,
		Matchers: []Matcher{{Type: "literal", Field: "to", Value: "ada@mail.example.com"}},
		Actions:  []Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
	}

	tests := []struct {
		name      string
		enabled   bool
		getStatus int
		putStatus int
		body      string
		wantErr   string
	}{
		{
			name:      "enable writes back the full rule with enabled true",
			enabled:   true,
			getStatus: http.StatusOK,
			putStatus: http.StatusOK,
		},
		{
			name:      "disable writes back the full rule with enabled false",
			enabled:   false,
			getStatus: http.StatusOK,
			putStatus: http.StatusOK,
		},
		{
			name:      "get failure surfaces the API error",
			enabled:   true,
			getStatus: http.StatusNotFound,
			body:      `{"success":false,"errors":[{"code":404,"message":"routing rule not found"}],"result":null}`,
			wantErr:   "error 404: routing rule not found",
		},
		{
			name:      "put failure surfaces the API error",
			enabled:   true,
			getStatus: http.StatusOK,
			putStatus: http.StatusForbidden,
			body:      `{"success":false,"errors":[{"code":10000,"message":"Authentication error"}],"result":null}`,
			wantErr:   "error 10000: Authentication error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotMethod string
			var gotBody string
			requests := 0
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				requests++
				if r.URL.Path != "/zones/zone-1/email/routing/rules/rule-1" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
				}
				w.Header().Set("Content-Type", "application/json")
				switch r.Method {
				case http.MethodGet:
					gotMethod = r.Method
					if tt.getStatus != http.StatusOK {
						w.WriteHeader(tt.getStatus)
						w.Write([]byte(tt.body))
						return
					}
					w.Write(envelopeJSON(t, existingRule))
				case http.MethodPut:
					gotMethod = r.Method
					raw, err := io.ReadAll(r.Body)
					if err != nil {
						t.Errorf("read body: %v", err)
					}
					gotBody = string(raw)
					if tt.putStatus != http.StatusOK {
						w.WriteHeader(tt.putStatus)
						w.Write([]byte(tt.body))
						return
					}
					w.Write(envelopeJSON(t, existingRule))
				default:
					t.Errorf("unexpected method %s", r.Method)
				}
			})

			err := client.UpdateRuleStatus(context.Background(), "zone-1", "rule-1", tt.enabled)

			if tt.wantErr != "" {
				if err == nil {
					t.Fatal("UpdateRuleStatus() = nil, want error")
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("UpdateRuleStatus() error = %q, want it to contain %q", err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("UpdateRuleStatus() error = %v, want nil", err)
			}
			if requests != 2 {
				t.Errorf("made %d requests, want 2 (GET then PUT)", requests)
			}
			if gotMethod != http.MethodPut {
				t.Errorf("last request method = %q, want PUT", gotMethod)
			}
			var sent Rule
			if err := json.Unmarshal([]byte(gotBody), &sent); err != nil {
				t.Fatalf("decode sent body: %v", err)
			}
			if sent.ID != existingRule.ID || !reflect.DeepEqual(sent.Matchers, existingRule.Matchers) || !reflect.DeepEqual(sent.Actions, existingRule.Actions) {
				t.Errorf("PUT body rule = %+v, want the full existing rule", sent)
			}
			if sent.Enabled != tt.enabled {
				t.Errorf("PUT body enabled = %v, want %v", sent.Enabled, tt.enabled)
			}
		})
	}
}
