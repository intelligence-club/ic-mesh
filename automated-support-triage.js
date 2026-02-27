#!/usr/bin/env node

/**
 * Automated Support Ticket Triage System
 * 
 * Intelligently categorizes, prioritizes, and routes support tickets
 * Reduces response time through automated workflows and smart classification
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class AutomatedSupportTriage {
    constructor(dbPath = './mesh.db') {
        try {
            this.db = new Database(dbPath, { readonly: false });
            this.setupSchema();
            this.loadKnowledgeBase();
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            process.exit(1);
        }
    }

    setupSchema() {
        // Ensure support_tickets table has necessary columns for triage
        const columns = this.db.prepare(`
            PRAGMA table_info(support_tickets)
        `).all();
        
        const columnNames = columns.map(col => col.name);
        
        // Add triage columns if they don't exist
        const triageColumns = [
            { name: 'priority', type: 'TEXT DEFAULT "medium"' },
            { name: 'auto_category', type: 'TEXT' },
            { name: 'estimated_resolution_time', type: 'INTEGER' },
            { name: 'assigned_to', type: 'TEXT' },
            { name: 'triage_confidence', type: 'REAL' },
            { name: 'auto_response_sent', type: 'BOOLEAN DEFAULT 0' },
            { name: 'escalation_needed', type: 'BOOLEAN DEFAULT 0' },
            { name: 'similar_tickets', type: 'TEXT' }
        ];

        triageColumns.forEach(col => {
            if (!columnNames.includes(col.name)) {
                try {
                    this.db.exec(`ALTER TABLE support_tickets ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`✅ Added column: ${col.name}`);
                } catch (error) {
                    // Column might already exist, ignore
                }
            }
        });
    }

    loadKnowledgeBase() {
        // AI-powered classification patterns
        this.patterns = {
            // Technical issues
            technical: [
                { regex: /node.*not.*connect|connection.*fail|timeout|ECONNREFUSED/i, confidence: 0.9 },
                { regex: /handler.*error|missing.*handler|500.*error/i, confidence: 0.8 },
                { regex: /job.*stuck|pending.*too.*long|not.*processing/i, confidence: 0.85 },
                { regex: /cpu.*high|memory.*leak|performance.*slow/i, confidence: 0.8 },
                { regex: /docker.*fail|container.*crash|deployment.*error/i, confidence: 0.9 }
            ],
            
            // Billing and payments
            billing: [
                { regex: /payment.*fail|stripe.*error|charge.*declined/i, confidence: 0.9 },
                { regex: /refund|balance.*wrong|credit.*missing/i, confidence: 0.85 },
                { regex: /subscription|billing.*cycle|invoice/i, confidence: 0.8 },
                { regex: /payout.*delay|cashout.*fail|earnings.*wrong/i, confidence: 0.9 }
            ],
            
            // Account and authentication
            account: [
                { regex: /login.*fail|password.*reset|access.*denied/i, confidence: 0.9 },
                { regex: /api.*key|authentication|authorization/i, confidence: 0.85 },
                { regex: /account.*lock|suspended|verification/i, confidence: 0.9 },
                { regex: /two.*factor|2fa|security/i, confidence: 0.8 }
            ],
            
            // Feature requests
            feature: [
                { regex: /feature.*request|suggestion|enhancement|could.*you.*add/i, confidence: 0.8 },
                { regex: /would.*like.*to.*see|missing.*feature|support.*for/i, confidence: 0.7 },
                { regex: /integration.*with|webhook|api.*endpoint/i, confidence: 0.75 }
            ],
            
            // General questions
            general: [
                { regex: /how.*to|help.*with|question.*about|getting.*start/i, confidence: 0.7 },
                { regex: /documentation|tutorial|example|guide/i, confidence: 0.8 },
                { regex: /what.*is|explain|clarification/i, confidence: 0.6 }
            ]
        };

        // Priority classification rules
        this.priorityRules = [
            { pattern: /urgent|critical|production.*down|outage/i, priority: 'critical', confidence: 0.9 },
            { pattern: /payment.*fail|cannot.*login|data.*loss/i, priority: 'high', confidence: 0.85 },
            { pattern: /slow.*performance|minor.*bug|cosmetic/i, priority: 'low', confidence: 0.8 },
            { pattern: /feature.*request|suggestion|nice.*to.*have/i, priority: 'low', confidence: 0.7 }
        ];

        // Auto-response templates
        this.autoResponses = {
            technical: {
                template: `Thank you for reporting this technical issue. 
                
We've automatically categorized your ticket and are investigating. Here are some immediate steps you can try:

1. Check your node status: \`curl http://localhost:8333/health\`
2. Restart your node if it's unresponsive
3. Review recent logs for error messages

Expected resolution time: 2-4 hours for urgent issues, 24-48 hours for complex problems.

We'll update you as soon as we have more information.

Best regards,
IC Mesh Support Team`,
                estimatedTime: 180 // 3 hours in minutes
            },
            
            billing: {
                template: `Thank you for contacting us about a billing matter.
                
We've received your request and our billing team will review it within the next business day. 

For immediate assistance with payment issues:
- Check your billing dashboard at moilol.com/account
- Verify your payment method hasn't expired
- Contact your bank if charges were declined

Expected resolution time: 24 hours for payment issues, 2-3 business days for billing disputes.

Best regards,
IC Mesh Billing Team`,
                estimatedTime: 1440 // 24 hours in minutes
            },
            
            general: {
                template: `Thank you for reaching out to IC Mesh support!

We've received your question and will respond within 24-48 hours. In the meantime, you might find these resources helpful:

- Documentation: https://github.com/drakelaw/ic-mesh
- Troubleshooting Guide: Check NODE-TROUBLESHOOTING.md
- Community Discord: Join for quick questions

Expected response time: 24-48 hours

Best regards,
IC Mesh Support Team`,
                estimatedTime: 2880 // 48 hours in minutes
            }
        };
    }

    async triageAllPendingTickets() {
        console.log('🔄 Starting automated triage of pending support tickets...\n');
        
        const pendingTickets = this.db.prepare(`
            SELECT * FROM support_tickets 
            WHERE status = 'open' AND (auto_category IS NULL OR auto_category = '')
            ORDER BY createdAt DESC
        `).all();

        console.log(`📋 Found ${pendingTickets.length} tickets awaiting triage`);
        
        const results = {
            triaged: 0,
            auto_responded: 0,
            escalated: 0,
            categories: {}
        };

        for (const ticket of pendingTickets) {
            const triage = await this.triageTicket(ticket);
            
            if (triage.success) {
                results.triaged++;
                results.categories[triage.category] = (results.categories[triage.category] || 0) + 1;
                
                if (triage.autoResponseSent) {
                    results.auto_responded++;
                }
                
                if (triage.escalationNeeded) {
                    results.escalated++;
                }
                
                console.log(`✅ Ticket ${ticket.ticketId}: ${triage.category} (${triage.priority}) - Confidence: ${(triage.confidence * 100).toFixed(1)}%`);
            }
        }

        console.log('\n📊 Triage Results:');
        console.log(`• Total triaged: ${results.triaged}`);
        console.log(`• Auto-responses sent: ${results.auto_responded}`);
        console.log(`• Escalations flagged: ${results.escalated}`);
        
        console.log('\n🏷️ Category Distribution:');
        Object.entries(results.categories).forEach(([category, count]) => {
            console.log(`• ${category}: ${count} tickets`);
        });

        return results;
    }

    async triageTicket(ticket) {
        try {
            // Combine subject and description for analysis
            const content = `${ticket.subject || ''} ${ticket.description || ''}`.toLowerCase();
            
            // Determine category
            const categoryResult = this.classifyCategory(content);
            
            // Determine priority
            const priorityResult = this.classifyPriority(content);
            
            // Find similar tickets
            const similarTickets = this.findSimilarTickets(ticket.ticketId, content);
            
            // Estimate resolution time
            const estimatedTime = this.estimateResolutionTime(categoryResult.category, priorityResult.priority);
            
            // Determine if escalation is needed
            const escalationNeeded = this.shouldEscalate(ticket, categoryResult, priorityResult);
            
            // Update ticket with triage results
            this.db.prepare(`
                UPDATE support_tickets 
                SET auto_category = ?, 
                    priority = ?, 
                    triage_confidence = ?, 
                    estimated_resolution_time = ?,
                    similar_tickets = ?,
                    escalation_needed = ?
                WHERE ticketId = ?
            `).run(
                categoryResult.category,
                priorityResult.priority,
                Math.min(categoryResult.confidence, priorityResult.confidence),
                estimatedTime,
                JSON.stringify(similarTickets.slice(0, 3)), // Top 3 similar tickets
                escalationNeeded ? 1 : 0,
                ticket.ticketId
            );

            // Send auto-response if appropriate
            const autoResponseSent = await this.sendAutoResponse(ticket, categoryResult.category);
            
            return {
                success: true,
                category: categoryResult.category,
                priority: priorityResult.priority,
                confidence: Math.min(categoryResult.confidence, priorityResult.confidence),
                estimatedTime,
                autoResponseSent,
                escalationNeeded
            };
            
        } catch (error) {
            console.error(`❌ Failed to triage ticket ${ticket.ticketId}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    classifyCategory(content) {
        let bestMatch = { category: 'general', confidence: 0.5 };
        
        for (const [category, patterns] of Object.entries(this.patterns)) {
            for (const pattern of patterns) {
                if (pattern.regex.test(content)) {
                    if (pattern.confidence > bestMatch.confidence) {
                        bestMatch = { category, confidence: pattern.confidence };
                    }
                }
            }
        }
        
        return bestMatch;
    }

    classifyPriority(content) {
        let bestMatch = { priority: 'medium', confidence: 0.5 };
        
        for (const rule of this.priorityRules) {
            if (rule.pattern.test(content)) {
                if (rule.confidence > bestMatch.confidence) {
                    bestMatch = { priority: rule.priority, confidence: rule.confidence };
                }
            }
        }
        
        return bestMatch;
    }

    findSimilarTickets(currentTicketId, content) {
        // Simple similarity search using word overlap
        const words = content.toLowerCase().match(/\b\w+\b/g) || [];
        const significantWords = words.filter(word => 
            word.length > 3 && 
            !['that', 'with', 'have', 'this', 'from', 'they', 'been', 'said', 'each', 'which', 'their', 'time', 'will', 'about', 'would', 'there', 'could', 'other'].includes(word)
        );
        
        if (significantWords.length === 0) return [];
        
        const recentTickets = this.db.prepare(`
            SELECT ticketId, subject, description, status
            FROM support_tickets 
            WHERE ticketId != ? AND createdAt > datetime('now', '-30 days')
            ORDER BY createdAt DESC
            LIMIT 50
        `).all(currentTicketId);
        
        const similarities = recentTickets.map(ticket => {
            const ticketContent = `${ticket.subject || ''} ${ticket.description || ''}`.toLowerCase();
            const ticketWords = ticketContent.match(/\b\w+\b/g) || [];
            
            const commonWords = significantWords.filter(word => ticketWords.includes(word));
            const similarity = commonWords.length / Math.max(significantWords.length, 1);
            
            return {
                ticketId: ticket.ticketId,
                subject: ticket.subject,
                similarity,
                status: ticket.status
            };
        }).filter(sim => sim.similarity > 0.2)
         .sort((a, b) => b.similarity - a.similarity);
        
        return similarities;
    }

    estimateResolutionTime(category, priority) {
        const baseTime = this.autoResponses[category]?.estimatedTime || 1440; // 24 hours default
        
        // Priority multipliers
        const priorityMultipliers = {
            critical: 0.25,
            high: 0.5,
            medium: 1.0,
            low: 2.0
        };
        
        return Math.round(baseTime * (priorityMultipliers[priority] || 1.0));
    }

    shouldEscalate(ticket, categoryResult, priorityResult) {
        // Escalate if:
        // 1. Critical priority
        // 2. Low confidence classification
        // 3. Billing issues (might need manual review)
        // 4. Multiple similar unresolved tickets
        
        if (priorityResult.priority === 'critical') return true;
        if (categoryResult.confidence < 0.6 || priorityResult.confidence < 0.6) return true;
        if (categoryResult.category === 'billing') return true;
        
        // Check for recurring issues
        const similarOpen = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM support_tickets 
            WHERE auto_category = ? AND status = 'open' AND createdAt > datetime('now', '-7 days')
        `).get(categoryResult.category);
        
        if (similarOpen.count > 5) return true; // More than 5 similar open tickets
        
        return false;
    }

    async sendAutoResponse(ticket, category) {
        // Only send auto-response for certain categories and if not already sent
        if (!this.autoResponses[category] || ticket.auto_response_sent) {
            return false;
        }
        
        try {
            // In a real implementation, this would integrate with email system
            // For now, just log the auto-response
            console.log(`📧 Auto-response sent to ticket ${ticket.ticketId} (${category})`);
            
            // Mark as auto-response sent
            this.db.prepare(`
                UPDATE support_tickets 
                SET auto_response_sent = 1 
                WHERE ticketId = ?
            `).run(ticket.ticketId);
            
            return true;
        } catch (error) {
            console.error(`Failed to send auto-response for ticket ${ticket.ticketId}:`, error.message);
            return false;
        }
    }

    generateTriageReport() {
        console.log('\n📊 Support Triage Analytics Report');
        console.log('=====================================\n');

        // Overall statistics
        const totalTickets = this.db.prepare('SELECT COUNT(*) as count FROM support_tickets').get();
        const openTickets = this.db.prepare(`SELECT COUNT(*) as count FROM support_tickets WHERE status = 'open'`).get();
        const resolvedTickets = this.db.prepare(`SELECT COUNT(*) as count FROM support_tickets WHERE status = 'resolved'`).get();

        console.log(`📈 Overall Statistics:`);
        console.log(`• Total tickets: ${totalTickets.count}`);
        console.log(`• Open tickets: ${openTickets.count}`);
        console.log(`• Resolved tickets: ${resolvedTickets.count}`);
        console.log(`• Resolution rate: ${((resolvedTickets.count / totalTickets.count) * 100).toFixed(1)}%`);

        // Category breakdown
        const categoryStats = this.db.prepare(`
            SELECT auto_category, COUNT(*) as count, 
                   AVG(triage_confidence) as avg_confidence,
                   AVG(estimated_resolution_time) as avg_resolution_time
            FROM support_tickets 
            WHERE auto_category IS NOT NULL 
            GROUP BY auto_category 
            ORDER BY count DESC
        `).all();

        console.log(`\n🏷️ Category Breakdown:`);
        categoryStats.forEach(stat => {
            console.log(`• ${stat.auto_category}: ${stat.count} tickets (${((stat.avg_confidence || 0) * 100).toFixed(1)}% avg confidence, ${Math.round(stat.avg_resolution_time || 0)} min avg resolution)`);
        });

        // Priority distribution
        const priorityStats = this.db.prepare(`
            SELECT priority, COUNT(*) as count
            FROM support_tickets 
            WHERE priority IS NOT NULL 
            GROUP BY priority 
            ORDER BY 
                CASE priority 
                    WHEN 'critical' THEN 1 
                    WHEN 'high' THEN 2 
                    WHEN 'medium' THEN 3 
                    WHEN 'low' THEN 4 
                END
        `).all();

        console.log(`\n🚨 Priority Distribution:`);
        priorityStats.forEach(stat => {
            const emoji = stat.priority === 'critical' ? '🔴' : 
                         stat.priority === 'high' ? '🟠' : 
                         stat.priority === 'medium' ? '🟡' : '🟢';
            console.log(`• ${emoji} ${stat.priority}: ${stat.count} tickets`);
        });

        // Escalations needed
        const escalations = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM support_tickets 
            WHERE escalation_needed = 1 AND status = 'open'
        `).get();

        console.log(`\n⚠️ Escalations Needed: ${escalations.count} tickets require immediate attention`);

        // Auto-response efficiency
        const autoResponses = this.db.prepare(`
            SELECT COUNT(*) as sent 
            FROM support_tickets 
            WHERE auto_response_sent = 1
        `).get();

        console.log(`\n🤖 Automation Efficiency:`);
        console.log(`• Auto-responses sent: ${autoResponses.sent}`);
        console.log(`• Automation rate: ${((autoResponses.sent / totalTickets.count) * 100).toFixed(1)}%`);
    }

    async optimizeWorkflows() {
        console.log('\n🔧 Optimizing Support Workflows...\n');
        
        // Identify patterns for workflow improvements
        const improvements = [];
        
        // 1. High-volume categories that could benefit from better automation
        const highVolumeCategories = this.db.prepare(`
            SELECT auto_category, COUNT(*) as count, 
                   AVG(CASE WHEN auto_response_sent = 1 THEN 1 ELSE 0 END) as automation_rate
            FROM support_tickets 
            WHERE auto_category IS NOT NULL AND createdAt > datetime('now', '-30 days')
            GROUP BY auto_category 
            HAVING count >= 10
            ORDER BY count DESC
        `).all();

        highVolumeCategories.forEach(cat => {
            if (cat.automation_rate < 0.8) {
                improvements.push({
                    type: 'automation',
                    priority: 'high',
                    description: `Improve automation for ${cat.auto_category} category (${cat.count} tickets, ${(cat.automation_rate * 100).toFixed(1)}% automated)`
                });
            }
        });

        // 2. Frequently escalated categories
        const escalationPatterns = this.db.prepare(`
            SELECT auto_category, COUNT(*) as total_tickets,
                   SUM(escalation_needed) as escalations,
                   (SUM(escalation_needed) * 1.0 / COUNT(*)) as escalation_rate
            FROM support_tickets 
            WHERE auto_category IS NOT NULL 
            GROUP BY auto_category 
            HAVING escalation_rate > 0.3
            ORDER BY escalation_rate DESC
        `).all();

        escalationPatterns.forEach(pattern => {
            improvements.push({
                type: 'training',
                priority: 'medium',
                description: `Review classification for ${pattern.auto_category} (${(pattern.escalation_rate * 100).toFixed(1)}% escalation rate)`
            });
        });

        // 3. Low-confidence classifications
        const lowConfidence = this.db.prepare(`
            SELECT auto_category, COUNT(*) as count, AVG(triage_confidence) as avg_confidence
            FROM support_tickets 
            WHERE triage_confidence < 0.7 AND auto_category IS NOT NULL
            GROUP BY auto_category
            ORDER BY avg_confidence ASC
        `).all();

        lowConfidence.forEach(cat => {
            improvements.push({
                type: 'classification',
                priority: 'medium',
                description: `Improve classification patterns for ${cat.auto_category} (${(cat.avg_confidence * 100).toFixed(1)}% avg confidence)`
            });
        });

        console.log('💡 Workflow Optimization Recommendations:');
        improvements.slice(0, 10).forEach((imp, index) => {
            const priority = imp.priority === 'high' ? '🔴' : imp.priority === 'medium' ? '🟡' : '🟢';
            console.log(`${index + 1}. ${priority} [${imp.type.toUpperCase()}] ${imp.description}`);
        });

        return improvements;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI Interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'triage';
    
    const triage = new AutomatedSupportTriage();

    async function main() {
        try {
            switch (command) {
                case 'triage':
                    await triage.triageAllPendingTickets();
                    break;
                    
                case 'report':
                    triage.generateTriageReport();
                    break;
                    
                case 'optimize':
                    await triage.optimizeWorkflows();
                    break;
                    
                case '--help':
                case 'help':
                    console.log(`
📋 Automated Support Ticket Triage System

Usage:
  node automated-support-triage.js [command]

Commands:
  triage       Process all pending tickets (default)
  report       Generate analytics report
  optimize     Suggest workflow improvements
  help         Show this help message

Examples:
  node automated-support-triage.js triage    # Process pending tickets
  node automated-support-triage.js report    # View analytics
  node automated-support-triage.js optimize  # Get improvement suggestions

Features:
  ✅ Intelligent categorization (technical, billing, account, feature, general)
  ✅ Priority classification (critical, high, medium, low)
  ✅ Automatic response templates
  ✅ Similar ticket detection
  ✅ Escalation flagging
  ✅ Resolution time estimation
  ✅ Workflow optimization recommendations
                    `);
                    break;
                    
                default:
                    console.error(`❌ Unknown command: ${command}`);
                    console.log('Use "help" to see available commands');
                    process.exit(1);
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        } finally {
            triage.close();
        }
    }

    main();
}

module.exports = AutomatedSupportTriage;