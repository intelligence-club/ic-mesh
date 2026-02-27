-- Founding Operator System Schema Extension
-- Adds tracking for founding operator status and benefits

-- Add founding operator fields to nodes table
ALTER TABLE nodes ADD COLUMN founding_operator BOOLEAN DEFAULT FALSE;
ALTER TABLE nodes ADD COLUMN founding_slot INTEGER DEFAULT NULL; -- 1-50 for the first 50
ALTER TABLE nodes ADD COLUMN founding_joined_at INTEGER DEFAULT NULL; -- timestamp when they became founding
ALTER TABLE nodes ADD COLUMN earning_multiplier REAL DEFAULT 1.0; -- 2.0 for founding operators

-- Create founding operator log table for auditing
CREATE TABLE IF NOT EXISTS founding_operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nodeId TEXT NOT NULL,
    email TEXT NOT NULL,
    slot_number INTEGER NOT NULL, -- 1-50
    joined_at INTEGER NOT NULL,
    status TEXT DEFAULT 'active', -- active, revoked, etc
    benefits TEXT DEFAULT '{"multiplier": 2.0, "priority_routing": true}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (nodeId) REFERENCES nodes(nodeId)
);

-- Create index for efficient founding operator queries
CREATE INDEX IF NOT EXISTS idx_founding_operators_slot ON founding_operators(slot_number);
CREATE INDEX IF NOT EXISTS idx_founding_operators_status ON founding_operators(status);
CREATE INDEX IF NOT EXISTS idx_nodes_founding ON nodes(founding_operator);

-- Create view for active founding operators
CREATE VIEW IF NOT EXISTS founding_operators_active AS
SELECT 
    n.nodeId,
    n.name,
    n.owner,
    n.payout_email,
    fo.slot_number,
    fo.joined_at,
    fo.benefits,
    n.jobsCompleted,
    n.computeMinutes
FROM nodes n
JOIN founding_operators fo ON n.nodeId = fo.nodeId
WHERE fo.status = 'active' AND n.founding_operator = TRUE;