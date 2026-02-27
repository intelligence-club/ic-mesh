#!/bin/bash

# setup-dev-environment.sh - Complete Development Environment Setup
# Ensures all monitoring, diagnostic, and operational tools work out of the box

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${1}"
}

log_step() {
    log "${BLUE}🔧 ${1}${NC}"
}

log_success() {
    log "${GREEN}✅ ${1}${NC}"
}

log_warn() {
    log "${YELLOW}⚠️  ${1}${NC}"
}

log_error() {
    log "${RED}❌ ${1}${NC}"
}

# Check if we're in the right directory
check_project_directory() {
    log_step "Checking project directory..."
    
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
        log_error "Not in IC Mesh project directory - package.json not found"
        log "Please run this script from the ic-mesh directory"
        exit 1
    fi
    
    if [ ! -f "$PROJECT_ROOT/server.js" ]; then
        log_error "IC Mesh server.js not found - are you in the right directory?"
        exit 1
    fi
    
    log_success "Project directory validated"
}

# Install Node.js dependencies
install_dependencies() {
    log_step "Installing Node.js dependencies..."
    
    cd "$PROJECT_ROOT"
    
    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
        log "Running npm install..."
        npm install --progress=false
        log_success "Dependencies installed"
    else
        log "Checking for missing dependencies..."
        if npm ls --depth=0 > /dev/null 2>&1; then
            log_success "All dependencies present"
        else
            log "Installing missing dependencies..."
            npm install --progress=false
            log_success "Missing dependencies installed"
        fi
    fi
}

# Check Node.js version
check_node_version() {
    log_step "Checking Node.js version..."
    
    local node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    
    if [ "$node_version" -ge 18 ]; then
        log_success "Node.js version: $(node --version) (compatible)"
    else
        log_warn "Node.js version: $(node --version) (may have compatibility issues)"
        log "Recommended: Node.js 18 or higher"
    fi
}

# Create data directory and initialize database
setup_database() {
    log_step "Setting up database..."
    
    cd "$PROJECT_ROOT"
    
    # Create data directory if it doesn't exist
    if [ ! -d "data" ]; then
        mkdir -p data
        log_success "Created data directory"
    fi
    
    # Check if database exists
    if [ ! -f "data/mesh.db" ]; then
        log_warn "Database not found - this is normal for new setups"
        log "Database will be created when server starts"
    else
        local db_size=$(du -h data/mesh.db | cut -f1)
        log_success "Database found: $db_size"
    fi
}

# Create environment file from example
setup_environment() {
    log_step "Setting up environment configuration..."
    
    cd "$PROJECT_ROOT"
    
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            log "Creating .env from .env.example..."
            cp .env.example .env
            log_success "Environment file created from example"
            log_warn "Review .env and configure with your specific settings"
        else
            log_warn "No .env or .env.example found"
            log "Environment variables will use defaults or be prompted when needed"
        fi
    else
        log_success "Environment file exists"
    fi
}

# Test critical monitoring tools
test_monitoring_tools() {
    log_step "Testing monitoring tools..."
    
    cd "$PROJECT_ROOT"
    
    # Test real-time capacity monitor
    if node real-time-capacity-monitor.js --check > /dev/null 2>&1; then
        log_success "Real-time capacity monitor: Working"
    else
        log_warn "Real-time capacity monitor: May need server to be running"
    fi
    
    # Test outage recovery detector
    if [ -x "scripts/outage-recovery-detector.sh" ]; then
        log_success "Outage recovery detector: Available"
    else
        log_warn "Outage recovery detector: Not found or not executable"
    fi
    
    # Test post-outage checklist
    if [ -x "scripts/post-outage-recovery-checklist.sh" ]; then
        log_success "Post-outage recovery checklist: Available"
    else
        log_warn "Post-outage recovery checklist: Not found or not executable"
    fi
    
    # Test status generator
    if [ -x "scripts/outage-status-generator.sh" ]; then
        log_success "Outage status generator: Available"
    else
        log_warn "Outage status generator: Not found or not executable"
    fi
}

# Test essential CLI commands
test_cli_commands() {
    log_step "Testing CLI commands..."
    
    cd "$PROJECT_ROOT"
    
    # Test health command (requires jq)
    if command -v jq > /dev/null 2>&1; then
        log_success "jq: Available for JSON processing"
    else
        log_warn "jq: Not available - some npm scripts may not work"
        log "Install with: sudo apt install jq (Ubuntu) or brew install jq (macOS)"
    fi
    
    # Test curl
    if command -v curl > /dev/null 2>&1; then
        log_success "curl: Available for API testing"
    else
        log_error "curl: Required but not found"
        log "Install with package manager (apt, yum, brew, etc.)"
    fi
}

# Set up shell scripts permissions
setup_script_permissions() {
    log_step "Setting up script permissions..."
    
    cd "$PROJECT_ROOT"
    
    # Find all shell scripts and make them executable
    local scripts_count=0
    
    find scripts/ -name "*.sh" -type f | while read script; do
        if [ ! -x "$script" ]; then
            chmod +x "$script"
            scripts_count=$((scripts_count + 1))
        fi
    done
    
    # Make specific scripts executable
    for script in "scripts/outage-recovery-detector.sh" "scripts/post-outage-recovery-checklist.sh" "scripts/outage-status-generator.sh"; do
        if [ -f "$script" ] && [ ! -x "$script" ]; then
            chmod +x "$script"
            scripts_count=$((scripts_count + 1))
        fi
    done
    
    log_success "Script permissions configured"
}

# Run basic health check
run_health_check() {
    log_step "Running basic health check..."
    
    cd "$PROJECT_ROOT"
    
    # Test Node.js syntax of main files
    if node -c server.js; then
        log_success "server.js: Syntax valid"
    else
        log_error "server.js: Syntax errors detected"
        return 1
    fi
    
    if [ -f "client.js" ] && node -c client.js; then
        log_success "client.js: Syntax valid"
    fi
    
    # Check for common required files
    local required_files=("package.json" "server.js")
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_success "$file: Present"
        else
            log_error "$file: Missing"
        fi
    done
}

# Display usage information
show_usage_info() {
    log ""
    log "${BLUE}🚀 Development Environment Setup Complete!${NC}"
    log "==========================================="
    log ""
    log "${GREEN}Essential Commands:${NC}"
    log "  npm start                     Start IC Mesh server"
    log "  npm test                      Run test suite" 
    log "  npm run health               Check service health (requires server running)"
    log "  npm run status               Show detailed status"
    log ""
    log "${GREEN}Monitoring Tools:${NC}"
    log "  node real-time-capacity-monitor.js --check        One-time capacity check"
    log "  ./scripts/outage-recovery-detector.sh --status    Service outage status"
    log "  ./scripts/outage-status-generator.sh discord      Generate status updates"
    log "  ./scripts/post-outage-recovery-checklist.sh       Post-recovery verification"
    log ""
    log "${GREEN}Development Workflow:${NC}"
    log "  1. Start server: npm start"
    log "  2. In another terminal: npm run health"
    log "  3. Run tests: npm test"
    log "  4. Monitor: node real-time-capacity-monitor.js --check"
    log ""
    log "${GREEN}Documentation:${NC}"
    log "  📖 OUTAGE-RESPONSE-PLAYBOOK.md    Complete outage response procedures"
    log "  📖 README.md                       Project overview and setup"
    log ""
    if [ -f ".env" ]; then
        log "${YELLOW}Next Steps:${NC}"
        log "  1. Review and configure .env file with your specific settings"
        log "  2. Start the server: npm start"
        log "  3. Test the setup: npm run health"
    else
        log "${YELLOW}Next Steps:${NC}"
        log "  1. Create .env file (copy from .env.example if available)"
        log "  2. Start the server: npm start"
        log "  3. Test the setup: npm run health"
    fi
    log ""
}

# Main setup function
main() {
    log "${BLUE}🔧 IC Mesh Development Environment Setup${NC}"
    log "========================================"
    log ""
    
    check_project_directory
    check_node_version
    install_dependencies
    setup_database
    setup_environment
    setup_script_permissions
    test_cli_commands
    test_monitoring_tools
    run_health_check
    
    show_usage_info
    
    log_success "Development environment setup complete!"
}

# Handle help option
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat << EOF
IC Mesh Development Environment Setup

Usage: $0 [OPTIONS]

This script sets up a complete development environment for IC Mesh:

Setup Steps:
  • Validates project directory
  • Checks Node.js version compatibility
  • Installs all npm dependencies
  • Creates database directory structure
  • Sets up environment configuration
  • Makes shell scripts executable
  • Tests monitoring tools
  • Runs basic health checks

Options:
  --help, -h    Show this help message

After setup, you'll have access to:
  • Full monitoring toolkit
  • Outage detection and recovery tools
  • Complete test suite
  • Development and production scripts

The setup is idempotent - safe to run multiple times.
EOF
    exit 0
fi

main "$@"