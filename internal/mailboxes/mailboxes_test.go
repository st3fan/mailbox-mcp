package mailboxes

import (
	"context"
	"errors"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/cloudflare"
	"github.com/st3fan/mailbox-mcp/internal/config"
)

// fakeClient is an in-memory client implementation that records calls.
type fakeClient struct {
	rules  []cloudflare.Rule
	nextID int

	listErr        error
	createErr      error
	createErrQueue []error
	deleteErr      error
	updateErr      error

	createdAddresses []string
	deletedRuleIDs   []string
	updates          []update
	createCalls      int
}

// update records one UpdateRuleStatus call.
type update struct {
	ruleID  string
	enabled bool
}

func (f *fakeClient) ListRules(ctx context.Context, zoneID string) ([]cloudflare.Rule, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.rules, nil
}

func (f *fakeClient) CreateMailboxRule(ctx context.Context, zoneID, address, worker string) (*cloudflare.Rule, error) {
	f.createCalls++
	err := f.createErr
	if len(f.createErrQueue) > 0 {
		err = f.createErrQueue[0]
		f.createErrQueue = f.createErrQueue[1:]
	}
	if err != nil {
		return nil, err
	}
	f.createdAddresses = append(f.createdAddresses, address)
	f.nextID++
	rule := &cloudflare.Rule{
		ID:       "rule-" + string(rune('0'+f.nextID)),
		Name:     address,
		Enabled:  true,
		Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: address}},
		Actions:  []cloudflare.Action{{Type: "worker", Value: []string{worker}}},
	}
	f.rules = append(f.rules, *rule)
	return rule, nil
}

func (f *fakeClient) DeleteRule(ctx context.Context, zoneID, ruleID string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	f.deletedRuleIDs = append(f.deletedRuleIDs, ruleID)
	return nil
}

func (f *fakeClient) UpdateRuleStatus(ctx context.Context, zoneID, ruleID string, enabled bool) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	f.updates = append(f.updates, update{ruleID, enabled})
	return nil
}

var testConfig = config.Config{
	CloudflareAPIToken: "token",
	Domain:             "mail.example.com",
	EmailWorker:        "mailbox-mcp-email-worker",
	Transport:          config.TransportStdio,
}

const testZone = "zone-1"

// call invokes a typed tool handler the way the SDK would.
func call[In, Out any](t *testing.T, h mcp.ToolHandlerFor[In, Out], input In) (Out, error) {
	t.Helper()
	_, out, err := h(context.Background(), &mcp.CallToolRequest{}, input)
	return out, err
}

func TestCreateMailbox(t *testing.T) {
	tests := []struct {
		name      string
		address   string
		want      mailbox
		wantErr   string
		wantCalls int
	}{
		{
			name:      "valid address",
			address:   "alice@mail.example.com",
			want:      mailbox{Address: "alice@mail.example.com", RuleID: "rule-1", Enabled: true},
			wantCalls: 1,
		},
		{
			name:      "address with different domain case is accepted",
			address:   "alice@MAIL.EXAMPLE.COM",
			want:      mailbox{Address: "alice@mail.example.com", RuleID: "rule-1", Enabled: true},
			wantCalls: 1,
		},
		{
			name:    "wrong domain is rejected without an API call",
			address: "bob@other.example.com",
			wantErr: "is not a mailbox on mail.example.com",
		},
		{
			name:    "missing @ is rejected",
			address: "alice",
			wantErr: "missing @",
		},
		{
			name:    "empty local part is rejected",
			address: "@mail.example.com",
			wantErr: "missing local part",
		},
		{
			name:    "whitespace is rejected",
			address: "a b@mail.example.com",
			wantErr: "contains whitespace",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{}
			got, err := call(t, createMailbox(testConfig, testZone, client), createInput{Address: tt.address})

			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("createMailbox() = %+v, want error containing %q", got, tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("error = %q, want it to contain %q", err.Error(), tt.wantErr)
				}
				if len(client.createdAddresses) != 0 {
					t.Errorf("created = %v, want no API calls", client.createdAddresses)
				}
				return
			}
			if err != nil {
				t.Fatalf("createMailbox() error = %v, want nil", err)
			}
			if got != tt.want {
				t.Errorf("createMailbox() = %+v, want %+v", got, tt.want)
			}
			if len(client.createdAddresses) != tt.wantCalls {
				t.Errorf("created %d rules, want %d", len(client.createdAddresses), tt.wantCalls)
			}
		})
	}
}

func TestCreateMailboxSurfacesCloudflareError(t *testing.T) {
	client := &fakeClient{createErr: errors.New("cloudflare: error 1004: address already exists")}
	_, err := call(t, createMailbox(testConfig, testZone, client), createInput{Address: "alice@mail.example.com"})
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %v, want the Cloudflare error to be surfaced", err)
	}
}
func TestListMailboxes(t *testing.T) {
	client := &fakeClient{
		rules: []cloudflare.Rule{
			{
				ID:       "rule-forward",
				Name:     "forward somewhere else",
				Enabled:  true,
				Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "legit@mail.example.com"}},
				Actions:  []cloudflare.Action{{Type: "forward", Value: []string{"admin@other.com"}}},
			},
			{
				ID:       "rule-catchall",
				Name:     "catch-all",
				Enabled:  true,
				Matchers: []cloudflare.Matcher{{Type: "all", Field: "to"}},
				Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"some-other-worker"}}},
			},
			{
				ID:       "rule-b",
				Name:     "bob@mail.example.com",
				Enabled:  true,
				Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "bob@mail.example.com"}},
				Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
			},
			{
				ID:       "rule-a",
				Name:     "alice@mail.example.com",
				Enabled:  false,
				Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "alice@mail.example.com"}},
				Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
			},
		},
	}

	got, err := call(t, listMailboxes(testConfig, testZone, client), listInput{})
	if err != nil {
		t.Fatalf("listMailboxes() error = %v, want nil", err)
	}
	want := listOutput{Mailboxes: []mailbox{
		{Address: "alice@mail.example.com", RuleID: "rule-a", Enabled: false},
		{Address: "bob@mail.example.com", RuleID: "rule-b", Enabled: true},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("listMailboxes() = %+v, want %+v (only our worker rules, sorted)", got, want)
	}
}

func TestListMailboxesSurfacesErrors(t *testing.T) {
	client := &fakeClient{listErr: errors.New("cloudflare: error 9109: Unauthorized")}
	_, err := call(t, listMailboxes(testConfig, testZone, client), listInput{})
	if err == nil || !strings.Contains(err.Error(), "Unauthorized") {
		t.Errorf("error = %v, want the Cloudflare error to be surfaced", err)
	}
}

func TestDeleteMailbox(t *testing.T) {
	tests := []struct {
		name       string
		rules      []cloudflare.Rule
		address    string
		want       deleteOutput
		wantErr    string
		wantDelete string
	}{
		{
			name: "known mailbox",
			rules: []cloudflare.Rule{
				{
					ID:       "rule-1",
					Name:     "alice@mail.example.com",
					Enabled:  true,
					Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "alice@mail.example.com"}},
					Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
				},
			},
			address:    "alice@mail.example.com",
			want:       deleteOutput{Address: "alice@mail.example.com", RuleID: "rule-1"},
			wantDelete: "rule-1",
		},
		{
			name:    "unknown mailbox",
			rules:   nil,
			address: "alice@mail.example.com",
			wantErr: "mailbox \"alice@mail.example.com\" not found",
		},
		{
			name: "rule for another worker is not a mailbox",
			rules: []cloudflare.Rule{
				{
					ID:       "rule-x",
					Name:     "alice@mail.example.com",
					Enabled:  true,
					Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "alice@mail.example.com"}},
					Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"someone-elses-worker"}}},
				},
			},
			address: "alice@mail.example.com",
			wantErr: "not found",
		},
		{
			name:    "address on another domain is rejected without an API call",
			address: "alice@other.example.com",
			wantErr: "is not a mailbox on mail.example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{rules: tt.rules}
			got, err := call(t, deleteMailbox(testConfig, testZone, client), deleteInput{Address: tt.address})

			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("deleteMailbox() = %+v, want error containing %q", got, tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("error = %q, want it to contain %q", err.Error(), tt.wantErr)
				}
				if len(client.deletedRuleIDs) != 0 {
					t.Errorf("deleted = %v, want no deletions", client.deletedRuleIDs)
				}
				return
			}
			if err != nil {
				t.Fatalf("deleteMailbox() error = %v, want nil", err)
			}
			if got != tt.want {
				t.Errorf("deleteMailbox() = %+v, want %+v", got, tt.want)
			}
			if len(client.deletedRuleIDs) != 1 || client.deletedRuleIDs[0] != tt.wantDelete {
				t.Errorf("deleted = %v, want [%s]", client.deletedRuleIDs, tt.wantDelete)
			}
		})
	}
}

func TestValidateAddress(t *testing.T) {
	tests := []struct {
		name    string
		address string
		domain  string
		wantErr string
	}{
		{name: "valid", address: "alice@mail.example.com", domain: "mail.example.com"},
		{name: "domain case-insensitive", address: "alice@Mail.Example.Com", domain: "mail.example.com"},
		{name: "empty", address: "", domain: "mail.example.com", wantErr: "required"},
		{name: "whitespace", address: "alice @mail.example.com", domain: "mail.example.com", wantErr: "whitespace"},
		{name: "no at", address: "alice", domain: "mail.example.com", wantErr: "missing @"},
		{name: "empty local", address: "@mail.example.com", domain: "mail.example.com", wantErr: "missing local part"},
		{name: "two ats", address: "a@b@mail.example.com", domain: "mail.example.com", wantErr: "multiple @"},
		{name: "wrong domain", address: "alice@other.com", domain: "mail.example.com", wantErr: "not a mailbox on"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAddress(tt.address, tt.domain)
			if tt.wantErr == "" {
				if err != nil {
					t.Errorf("validateAddress(%q) error = %v, want nil", tt.address, err)
				}
				return
			}
			if err == nil {
				t.Errorf("validateAddress(%q) = nil, want error containing %q", tt.address, tt.wantErr)
			} else if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("validateAddress(%q) error = %q, want it to contain %q", tt.address, err.Error(), tt.wantErr)
			}
		})
	}
}

func TestEnableDisableMailbox(t *testing.T) {
	adaRule := cloudflare.Rule{
		ID:       "rule-ada",
		Name:     "ada@mail.example.com",
		Enabled:  true,
		Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "ada@mail.example.com"}},
		Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
	}

	tests := []struct {
		name       string
		handler    func(client client, addr string) (mailbox, error)
		address    string
		want       mailbox
		wantErr    string
		wantUpdate *update
	}{
		{
			name: "disable known mailbox",
			handler: func(c client, a string) (mailbox, error) {
				return call(t, disableMailbox(testConfig, testZone, c), disableInput{Address: a})
			},
			address:    "ada@mail.example.com",
			want:       mailbox{Address: "ada@mail.example.com", RuleID: "rule-ada", Enabled: false},
			wantUpdate: &update{"rule-ada", false},
		},
		{
			name: "enable known mailbox",
			handler: func(c client, a string) (mailbox, error) {
				return call(t, enableMailbox(testConfig, testZone, c), enableInput{Address: a})
			},
			address:    "ada@mail.example.com",
			want:       mailbox{Address: "ada@mail.example.com", RuleID: "rule-ada", Enabled: true},
			wantUpdate: &update{"rule-ada", true},
		},
		{
			name: "unknown mailbox",
			handler: func(c client, a string) (mailbox, error) {
				return call(t, disableMailbox(testConfig, testZone, c), disableInput{Address: a})
			},
			address: "missing@mail.example.com",
			wantErr: "mailbox \"missing@mail.example.com\" not found",
		},
		{
			name: "out-of-domain address rejected without API calls",
			handler: func(c client, a string) (mailbox, error) {
				return call(t, enableMailbox(testConfig, testZone, c), enableInput{Address: a})
			},
			address: "ada@other.example.com",
			wantErr: "is not a mailbox on mail.example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{rules: []cloudflare.Rule{adaRule}}
			got, err := tt.handler(client, tt.address)

			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("handler() = %+v, want error containing %q", got, tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("error = %q, want it to contain %q", err.Error(), tt.wantErr)
				}
				if len(client.updates) != 0 {
					t.Errorf("updates = %v, want none", client.updates)
				}
				return
			}
			if err != nil {
				t.Fatalf("handler() error = %v, want nil", err)
			}
			if got != tt.want {
				t.Errorf("handler() = %+v, want %+v", got, tt.want)
			}
			if len(client.updates) != 1 || client.updates[0] != *tt.wantUpdate {
				t.Errorf("updates = %v, want [%v]", client.updates, *tt.wantUpdate)
			}
		})
	}
}

func TestDisableMailboxSurfacesCloudflareError(t *testing.T) {
	client := &fakeClient{
		rules: []cloudflare.Rule{
			{
				ID:       "rule-ada",
				Name:     "ada@mail.example.com",
				Enabled:  true,
				Matchers: []cloudflare.Matcher{{Type: "literal", Field: "to", Value: "ada@mail.example.com"}},
				Actions:  []cloudflare.Action{{Type: "worker", Value: []string{"mailbox-mcp-email-worker"}}},
			},
		},
		updateErr: errors.New("cloudflare: error 1004: something went wrong"),
	}
	_, err := call(t, disableMailbox(testConfig, testZone, client), disableInput{Address: "ada@mail.example.com"})
	if err == nil || !strings.Contains(err.Error(), "something went wrong") {
		t.Errorf("error = %v, want the Cloudflare error to be surfaced", err)
	}
}

func TestCreateRandomMailbox(t *testing.T) {
	localPart := regexp.MustCompile(`^[a-z]+\.[a-z]+$`)

	client := &fakeClient{}
	got, err := call(t, createRandomMailbox(testConfig, testZone, client), createRandomInput{})
	if err != nil {
		t.Fatalf("createRandomMailbox() error = %v, want nil", err)
	}
	if len(client.createdAddresses) != 1 {
		t.Fatalf("created = %v, want exactly one address", client.createdAddresses)
	}
	address := client.createdAddresses[0]
	if got.Address != address {
		t.Errorf("Address = %q, want the created address %q", got.Address, address)
	}
	local, domain, found := strings.Cut(address, "@")
	if !found {
		t.Fatalf("created address %q has no @", address)
	}
	if domain != testConfig.Domain {
		t.Errorf("created address domain = %q, want %q", domain, testConfig.Domain)
	}
	if !localPart.MatchString(local) {
		t.Errorf("created local part = %q, want lowercase first.last", local)
	}
	if got.RuleID == "" || !got.Enabled {
		t.Errorf("CreateRandomMailbox() = %+v, want a rule ID and enabled", got)
	}
}

func TestCreateRandomMailboxRetriesOnDuplicate(t *testing.T) {
	client := &fakeClient{
		createErrQueue: []error{
			errors.New("cloudflare: error 1004: address already exists"),
			errors.New("cloudflare: error 1004: duplicate rule"),
		},
	}
	got, err := call(t, createRandomMailbox(testConfig, testZone, client), createRandomInput{})
	if err != nil {
		t.Fatalf("createRandomMailbox() error = %v, want nil", err)
	}
	// Both duplicate errors were consumed and retried; only the successful
	// create is recorded by the fake.
	if len(client.createdAddresses) != 1 {
		t.Errorf("created = %v, want exactly one successful create", client.createdAddresses)
	}
	if got.Address != client.createdAddresses[0] {
		t.Errorf("Address = %q, want the successful address %q", got.Address, client.createdAddresses[0])
	}
}

func TestCreateRandomMailboxGivesUpAfterMaxAttempts(t *testing.T) {
	client := &fakeClient{
		createErr: errors.New("cloudflare: error 1004: address already exists"),
	}
	_, err := call(t, createRandomMailbox(testConfig, testZone, client), createRandomInput{})
	if err == nil {
		t.Fatal("createRandomMailbox() = nil error, want exhausted-attempts error")
	}
	if !strings.Contains(err.Error(), "no unique random mailbox after 3 attempts") {
		t.Errorf("error = %q, want the exhausted-attempts message", err.Error())
	}
	if client.createCalls != maxRandomCreateAttempts {
		t.Errorf("made %d create attempts, want %d", client.createCalls, maxRandomCreateAttempts)
	}
}

func TestCreateRandomMailboxSurfacesNonDuplicateErrors(t *testing.T) {
	client := &fakeClient{createErr: errors.New("cloudflare: error 9109: Unauthorized")}
	_, err := call(t, createRandomMailbox(testConfig, testZone, client), createRandomInput{})
	if err == nil || !strings.Contains(err.Error(), "Unauthorized") {
		t.Errorf("error = %v, want the Cloudflare error to be surfaced without retries", err)
	}
	if len(client.createdAddresses) != 0 {
		t.Errorf("created = %v, want a single attempt with no successful creates", client.createdAddresses)
	}
}
