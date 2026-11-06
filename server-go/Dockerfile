# Сборка Go-сервера «Созвон» для Docker.
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY server-go/go.mod server-go/go.sum ./
RUN go mod download
COPY server-go/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /out/sozvon .

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home --home-dir /data sozvon
COPY --from=build /out/sozvon /usr/local/bin/sozvon
USER sozvon
WORKDIR /data
ENV DATA_DIR=/data PORT=3000
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/sozvon"]
