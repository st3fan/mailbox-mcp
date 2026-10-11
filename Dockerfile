# Build stage
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mailbox-mcp ./cmd/mailbox-mcp

# Run stage
FROM alpine:3.22
# ca-certificates: the server talks to the Cloudflare API over HTTPS.
RUN apk add --no-cache ca-certificates
COPY --from=build /out/mailbox-mcp /usr/local/bin/mailbox-mcp
ENTRYPOINT ["mailbox-mcp"]