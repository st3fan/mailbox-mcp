// Package config loads and validates the mailbox-mcp server configuration from
// environment variables.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const (
	// EnvCloudflareAPIToken is the scoped Cloudflare API token used to talk to
	// the Email Routing API. It needs the Zone > Email Routing Rules > Edit
	// permission.
	EnvCloudflareAPIToken = "MAILBOX_MCP_CLOUDFLARE_API_TOKEN"

	// EnvDomain is the single email domain the server manages mailboxes on,
	// for example "mail.example.com".
	EnvDomain = "MAILBOX_MCP_DOMAIN"

	// EnvEmailWorker is the name of the Cloudflare Email Worker that mailboxes
	// route to.
	EnvEmailWorker = "MAILBOX_MCP_EMAIL_WORKER"

	// EnvTransport selects the MCP transport.
	EnvTransport = "MAILBOX_MCP_TRANSPORT"

	// EnvHTTPAddr is the listen address (host:port) of the HTTP transport.
	// The MCP endpoint is served at /mcp on it.
	EnvHTTPAddr = "MAILBOX_MCP_HTTP_ADDR"

	// EnvMessagesAPIURL is the base URL of the messages API worker that serves
	// the mail the email worker stores in R2, for example
	// "https://messages.example.com".
	EnvMessagesAPIURL = "MAILBOX_MCP_MESSAGES_API_URL"

	// EnvMessagesAPIToken is the bearer token the messages API requires.
	EnvMessagesAPIToken = "MAILBOX_MCP_MESSAGES_API_TOKEN"

	// DefaultEmailWorker is the worker used when EnvEmailWorker is unset.
	DefaultEmailWorker = "mailbox-mcp-email-worker"

	// DefaultTransport is the transport used when EnvTransport is unset.
	DefaultTransport = "stdio"

	// DefaultHTTPAddr is the listen address used by the HTTP transport when
	// EnvHTTPAddr is unset. It binds to localhost: the MCP endpoint has no
	// authentication, so it must not be reachable from other hosts unless the
	// operator explicitly changes the address.
	DefaultHTTPAddr = "localhost:8080"

	// dotenvFile is read from the working directory to fill configuration
	// variables that are not set in the environment.
	dotenvFile = ".env"
)

// TransportStdio is the MCP transport over stdin/stdout, the default.
const TransportStdio = "stdio"

// TransportHTTP is the MCP transport as streamable HTTP at /mcp. The SSE
// transport is deliberately not supported: it is deprecated in the MCP spec.
const TransportHTTP = "http"

// Config is the validated server configuration.
type Config struct {
	// CloudflareAPIToken authenticates calls to the Cloudflare API.
	CloudflareAPIToken string

	// Domain is the single email domain mailboxes are managed on.
	Domain string

	// EmailWorker is the Email Worker mailboxes route to.
	EmailWorker string

	// Transport is the MCP transport to serve on.
	Transport string

	// HTTPAddr is the listen address (host:port) of the HTTP transport. The
	// MCP endpoint is served at /mcp on it.
	HTTPAddr string

	// MessagesAPIURL is the base URL of the messages API worker.
	MessagesAPIURL string

	// MessagesAPIToken authenticates calls to the messages API.
	MessagesAPIToken string
}

// Load reads the configuration from the environment, applies defaults, and
// validates it. Variables that are not set in the environment are filled from
// a .env file in the working directory, if present; the environment always
// wins. It returns an error describing every problem it found, so a
// misconfigured server fails fast at startup.
func Load() (Config, error) {
	dotenv, err := readDotenv(dotenvFile)
	if err != nil {
		return Config{}, err
	}
	// value reads a variable from the environment, falling back to .env.
	value := func(key string) string {
		if v, ok := os.LookupEnv(key); ok {
			return strings.TrimSpace(v)
		}
		return strings.TrimSpace(dotenv[key])
	}

	cfg := Config{
		CloudflareAPIToken: value(EnvCloudflareAPIToken),
		Domain:             value(EnvDomain),
		EmailWorker:        value(EnvEmailWorker),
		Transport:          value(EnvTransport),
		HTTPAddr:           value(EnvHTTPAddr),
		MessagesAPIURL:     value(EnvMessagesAPIURL),
		MessagesAPIToken:   value(EnvMessagesAPIToken),
	}
	if cfg.EmailWorker == "" {
		cfg.EmailWorker = DefaultEmailWorker
	}
	if cfg.Transport == "" {
		cfg.Transport = DefaultTransport
	}

	var errs []error
	if cfg.CloudflareAPIToken == "" {
		errs = append(errs, fmt.Errorf("%s is required (set it in the environment or in .env)", EnvCloudflareAPIToken))
	}
	if cfg.Domain == "" {
		errs = append(errs, fmt.Errorf("%s is required (set it in the environment or in .env)", EnvDomain))
	} else if err := validateDomain(cfg.Domain); err != nil {
		errs = append(errs, fmt.Errorf("%s: %w", EnvDomain, err))
	}
	switch cfg.Transport {
	case TransportStdio:
	case TransportHTTP:
		if cfg.HTTPAddr == "" {
			cfg.HTTPAddr = DefaultHTTPAddr
		}
		if err := validateHTTPAddr(cfg.HTTPAddr); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", EnvHTTPAddr, err))
		}
	default:
		errs = append(errs, fmt.Errorf("%s: unknown transport %q (supported: %s, %s)", EnvTransport, cfg.Transport, TransportStdio, TransportHTTP))
	}

	// The messages API is required: the message tools need it to serve mail.
	if cfg.MessagesAPIURL == "" || cfg.MessagesAPIToken == "" {
		errs = append(errs, fmt.Errorf("both %s and %s are required (set them in the environment or in .env)", EnvMessagesAPIURL, EnvMessagesAPIToken))
	} else if err := validateBaseURL(cfg.MessagesAPIURL); err != nil {
		errs = append(errs, fmt.Errorf("%s: %w", EnvMessagesAPIURL, err))
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// validateBaseURL checks that a messages API base URL is an absolute http(s)
// URL with a host.
func validateBaseURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%q is not a valid base URL: %w", raw, err)
	}
	switch parsed.Scheme {
	case "http", "https":
	default:
		return fmt.Errorf("%q is not a valid base URL: scheme must be http or https", raw)
	}
	if parsed.Host == "" {
		return fmt.Errorf("%q is not a valid base URL: missing host", raw)
	}
	return nil
}

// validateHTTPAddr checks that an HTTP listen address is host:port with a
// numeric port. An empty host (":8080") binds all interfaces and is allowed.
func validateHTTPAddr(addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("%q is not a valid listen address: %w (expected host:port, e.g. %s)", addr, err, DefaultHTTPAddr)
	}
	if _, err := strconv.Atoi(port); err != nil {
		return fmt.Errorf("%q is not a valid listen address: port %q is not numeric", addr, port)
	}
	return nil
}

// readDotenv parses a .env-style file into a map. A missing file is not an
// error; the map is then empty. The format is kept minimal: KEY=VALUE lines,
// blank lines and # comments ignored, an optional "export " prefix, and
// optional surrounding quotes on values. Unknown keys are kept in the map but
// only the known variables are consulted. Values are not trimmed here; Load
// trims everything it uses.
func readDotenv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	defer f.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if key == "" {
			continue
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return values, nil
}

// validateDomain performs a basic sanity check on a domain name. Full DNS
// validation happens when the domain is resolved against the Cloudflare API.
func validateDomain(domain string) error {
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return fmt.Errorf("%q is not a valid domain name: expected at least two labels", domain)
	}
	for _, label := range labels {
		if label == "" {
			return fmt.Errorf("%q is not a valid domain name: empty label", domain)
		}
		if len(label) > 63 {
			return fmt.Errorf("%q is not a valid domain name: label %q is longer than 63 characters", domain, label)
		}
		for _, r := range label {
			switch {
			case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			default:
				return fmt.Errorf("%q is not a valid domain name: invalid character %q in label %q", domain, r, label)
			}
		}
	}
	return nil
}
