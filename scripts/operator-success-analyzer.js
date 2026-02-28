#!/usr/bin/env node

/**
 * IC Mesh Operator Success Analyzer
 * 
 * Analyzes operator performance, earnings, and provides insights for network growth.
 * Generates reports useful for both individual operators and network management.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'data', 'mesh.db');

class OperatorAnalyzer {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH);
    }

    async analyzeOperatorPerformance() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    j.claimedBy as nodeId,
                    n.name as nodeName,
                    COUNT(*) as totalJobs,
                    SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                    SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failedJobs,
                    ROUND(AVG(CASE WHEN j.status = 'completed' THEN j.computeMs/1000.0 ELSE NULL END), 2) as avgDuration,
                    SUM(CASE WHEN j.status = 'completed' THEN j.creditAmount ELSE 0 END) as totalEarnings,
                    MAX(j.completedAt) as lastActivity,
                    MIN(j.claimedAt) as firstActivity,
                    GROUP_CONCAT(DISTINCT j.type) as capabilities,
                    COUNT(DISTINCT DATE(j.createdAt, 'unixepoch')) as activeDays
                FROM jobs j
                LEFT JOIN nodes n ON j.claimedBy = n.nodeId
                WHERE j.claimedBy IS NOT NULL
                GROUP BY j.claimedBy, n.name
                ORDER BY totalEarnings DESC
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getNetworkStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(DISTINCT claimedBy) as totalOperators,
                    COUNT(*) as totalJobs,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                    SUM(CASE WHEN status = 'completed' THEN creditAmount ELSE 0 END) as totalRevenue,
                    ROUND(AVG(CASE WHEN status = 'completed' THEN creditAmount ELSE NULL END), 4) as avgJobValue,
                    COUNT(DISTINCT type) as distinctJobTypes
                FROM jobs 
                WHERE claimedBy IS NOT NULL
            `;

            this.db.get(query, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getJobTypePerformance() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    type as jobType,
                    COUNT(*) as totalJobs,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                    ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 1) as successRate,
                    SUM(CASE WHEN status = 'completed' THEN creditAmount ELSE 0 END) as totalRevenue,
                    ROUND(AVG(CASE WHEN status = 'completed' THEN creditAmount ELSE NULL END), 4) as avgPayment,
                    ROUND(AVG(CASE WHEN status = 'completed' THEN computeMs/1000.0 ELSE NULL END), 2) as avgDuration
                FROM jobs 
                WHERE type IS NOT NULL AND claimedBy IS NOT NULL
                GROUP BY type
                ORDER BY totalRevenue DESC
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getRecentActivity() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    DATE(createdAt, 'unixepoch') as date,
                    COUNT(*) as totalJobs,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                    SUM(CASE WHEN status = 'completed' THEN creditAmount ELSE 0 END) as dailyRevenue,
                    COUNT(DISTINCT claimedBy) as activeOperators
                FROM jobs 
                WHERE createdAt >= strftime('%s', 'now', '-30 days') AND claimedBy IS NOT NULL
                GROUP BY DATE(createdAt, 'unixepoch')
                ORDER BY date DESC
                LIMIT 30
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    formatCurrency(amount) {
        return `$${parseFloat(amount || 0).toFixed(2)}`;
    }

    formatDuration(seconds) {
        if (!seconds) return 'N/A';
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
        return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    }

    async generateReport() {
        console.log('🔍 IC Mesh Operator Success Analysis\n');

        try {
            // Network Overview
            const networkStats = await this.getNetworkStats();
            console.log('📊 Network Overview:');
            console.log(`   Total Operators: ${networkStats.totalOperators}`);
            console.log(`   Total Jobs: ${networkStats.totalJobs}`);
            console.log(`   Completed Jobs: ${networkStats.completedJobs}`);
            console.log(`   Success Rate: ${((networkStats.completedJobs / networkStats.totalJobs) * 100).toFixed(1)}%`);
            console.log(`   Total Network Revenue: ${this.formatCurrency(networkStats.totalRevenue)}`);
            console.log(`   Average Job Value: ${this.formatCurrency(networkStats.avgJobValue)}`);
            console.log(`   Job Types Available: ${networkStats.distinctJobTypes}`);
            console.log('');

            // Top Operators
            const operators = await this.analyzeOperatorPerformance();
            console.log('🏆 Top Performing Operators:');
            operators.slice(0, 10).forEach((op, i) => {
                const successRate = ((op.completedJobs / op.totalJobs) * 100).toFixed(1);
                const avgEarningsPerJob = op.totalEarnings / op.completedJobs;
                console.log(`   ${i + 1}. ${op.nodeName || op.nodeId.substring(0, 8)}...`);
                console.log(`      Earnings: ${this.formatCurrency(op.totalEarnings)} (${op.completedJobs} jobs, ${successRate}% success)`);
                console.log(`      Avg per job: ${this.formatCurrency(avgEarningsPerJob)} | Avg duration: ${this.formatDuration(op.avgDuration)}`);
                console.log(`      Active for ${op.activeDays} days | Capabilities: ${op.capabilities}`);
                console.log('');
            });

            // Job Type Performance
            const jobTypes = await this.getJobTypePerformance();
            console.log('📈 Job Type Performance:');
            jobTypes.forEach(jt => {
                console.log(`   ${jt.jobType}:`);
                console.log(`      Revenue: ${this.formatCurrency(jt.totalRevenue)} (${jt.completedJobs}/${jt.totalJobs} jobs, ${jt.successRate}% success)`);
                console.log(`      Avg payment: ${this.formatCurrency(jt.avgPayment)} | Avg duration: ${this.formatDuration(jt.avgDuration)}`);
                console.log('');
            });

            // Recent Activity
            const recentActivity = await this.getRecentActivity();
            console.log('📅 Recent Network Activity (Last 30 Days):');
            console.log('   Date        Jobs   Completed   Revenue    Active Ops');
            recentActivity.slice(0, 10).forEach(day => {
                const dateStr = new Date(day.date).toLocaleDateString();
                const jobsStr = day.totalJobs.toString().padEnd(6);
                const completedStr = day.completedJobs.toString().padEnd(10);
                const revenueStr = this.formatCurrency(day.dailyRevenue).padEnd(10);
                const opsStr = day.activeOperators.toString().padEnd(10);
                console.log(`   ${dateStr.padEnd(11)} ${jobsStr} ${completedStr} ${revenueStr} ${opsStr}`);
            });

            // Success Insights
            console.log('\n💡 Success Insights:');
            
            const topOperator = operators[0];
            if (topOperator) {
                const hourlyRate = topOperator.totalEarnings / (topOperator.avgDuration * topOperator.completedJobs / 3600);
                console.log(`   • Top operator earns ~${this.formatCurrency(hourlyRate)}/hour`);
                console.log(`   • Most profitable capability: ${jobTypes[0]?.jobType} (${this.formatCurrency(jobTypes[0]?.avgPayment)}/job)`);
            }

            const totalNetworkUptime = operators.reduce((sum, op) => sum + (op.activeDays || 0), 0);
            const avgDailyEarnings = networkStats.totalRevenue / (totalNetworkUptime / operators.length);
            console.log(`   • Average daily earnings per active operator: ${this.formatCurrency(avgDailyEarnings)}`);

            if (operators.length >= 2) {
                const retention = operators.filter(op => op.activeDays > 1).length / operators.length;
                console.log(`   • Operator retention rate: ${(retention * 100).toFixed(1)}% (${operators.filter(op => op.activeDays > 1).length}/${operators.length})`);
            }

            console.log('\n🚀 Growth Recommendations:');
            console.log('   • Focus recruiting on high-value job types');
            console.log('   • Improve onboarding for better retention');
            console.log('   • Create operator success stories for marketing');
            console.log('   • Consider incentive bonuses for consistent operators');

        } catch (error) {
            console.error('Error generating report:', error);
        }
    }

    close() {
        this.db.close();
    }
}

// Run the analysis
if (require.main === module) {
    const analyzer = new OperatorAnalyzer();
    analyzer.generateReport().finally(() => {
        analyzer.close();
    });
}

module.exports = OperatorAnalyzer;