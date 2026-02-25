# Docker Deployment Guide

## Quick Local Test

```bash
# Test the Docker build and basic functionality
./test-docker.sh
```

## Deploy to Remote Server

### Prerequisites

1. Docker and docker-compose installed on target server
2. Environment variables configured (if using external services)
3. Persistent volume or bind mount for data

### Option 1: Docker Compose (Recommended)

```bash
# Copy files to server
scp docker-compose.yml user@server:~/ic-mesh/
scp .env user@server:~/ic-mesh/  # if you have environment variables

# SSH to server and deploy
ssh user@server
cd ic-mesh
docker-compose up -d

# Check status
docker-compose logs -f
docker-compose ps
```

### Option 2: Direct Docker Run

```bash
# Build and run directly
docker build -t ic-mesh:latest .
docker run -d \
  --name ic-mesh \
  -p 8333:8333 \
  -v mesh-data:/app/data \
  --restart unless-stopped \
  ic-mesh:latest
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8333` | Port to bind the server |
| `DATA_DIR` | `/app/data` | Directory for data files |
| `DATABASE_PATH` | `/app/data/mesh.db` | SQLite database path |
| `ADMIN_KEY` | `ic-admin-2026` | Admin API key |
| `STRIPE_SECRET_KEY` | - | Stripe API key (optional) |
| `DO_SPACES_KEY` | - | DigitalOcean Spaces key (optional) |
| `DO_SPACES_SECRET` | - | DigitalOcean Spaces secret (optional) |

## Common Issues & Fixes

### Container doesn't start
- Check logs: `docker logs <container-name>`
- Verify port isn't already in use: `netstat -tlnp | grep 8333`
- Ensure data directory permissions are correct

### Database issues
- Ensure persistent volume is mounted: `-v mesh-data:/app/data`
- Check SQLite permissions in container
- Verify `DATABASE_PATH` environment variable

### Network issues
- Confirm port mapping: `-p 8333:8333`
- Check firewall rules: `ufw status`
- Verify container is binding to `0.0.0.0:8333`, not `localhost`

### Health check failures
- Wait longer for startup (SQLite initialization takes time)
- Check if `/status` endpoint is responding manually:
  ```bash
  curl http://localhost:8333/status
  ```

## Monitoring

```bash
# Check container health
docker ps
docker stats <container-name>

# View logs
docker logs -f <container-name>

# Enter container for debugging
docker exec -it <container-name> /bin/bash
```

## Backup & Recovery

```bash
# Backup data volume
docker run --rm -v mesh-data:/data -v $(pwd):/backup ubuntu tar czf /backup/mesh-backup.tar.gz -C /data .

# Restore data volume
docker run --rm -v mesh-data:/data -v $(pwd):/backup ubuntu tar xzf /backup/mesh-backup.tar.gz -C /data
```

## Scaling to Multiple Containers

When ready to scale beyond a single container, use the approach outlined in `docs/SCALING.md`:

1. Split frontend (ints/payments) from mesh coordination
2. Use shared PostgreSQL database instead of SQLite
3. Load balancer in front of multiple frontend instances
4. File storage moved to DigitalOcean Spaces completely

The current Docker setup supports this transition seamlessly via environment variables.