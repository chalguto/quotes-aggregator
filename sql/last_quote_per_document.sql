-- =============================================================================
-- Task : Retrieve the LAST (most recent) quote per documentId
--        for a list of up to 500 document IDs.
-- RDBMS: Microsoft SQL Server (T-SQL)
-- =============================================================================
-- Table schema assumed:
--
--   CREATE TABLE quotes (
--     id            VARCHAR(64)    NOT NULL PRIMARY KEY,
--     document_id   VARCHAR(50)    NOT NULL,
--     document_type VARCHAR(20)    NOT NULL,
--     insured_name  VARCHAR(255)   NULL,
--     insured_email VARCHAR(255)   NULL,
--     coverage_amt  DECIMAL(15,2)  NULL,
--     premium       DECIMAL(15,2)  NULL,
--     currency      CHAR(3)        NULL,
--     status        VARCHAR(20)    NULL,
--     effective_dt  DATE           NULL,
--     expiry_dt     DATE           NULL,
--     created_at    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
--     updated_at    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
--   );
-- =============================================================================


-- =============================================================================
-- STEP 0: Declare the table variable and load the target document IDs
-- =============================================================================
-- A table variable is scoped to the current batch/procedure, requires no
-- cleanup, and avoids tempdb contention from DDL on #temp tables.
-- For up to 500 rows the optimiser treats it like a small in-memory set.
--
-- NOTE: Table variables do not support statistics; if performance degrades
-- with very large ID lists (>1 000 rows) switch to a #temp table instead.
-- =============================================================================

DECLARE @target_docs TABLE (
    document_id VARCHAR(50) NOT NULL PRIMARY KEY
);

-- The application inserts the IDs before running the main query, e.g.:
--   INSERT INTO @target_docs (document_id) VALUES (@id1), (@id2), ...;


-- =============================================================================
-- SOLUTION 1 (recommended): ROW_NUMBER() window function
-- =============================================================================
-- Ranks every quote for each document_id by created_at DESC (rank 1 = newest).
-- Uses id DESC as a tie-breaker when two quotes share the same timestamp.
-- Returns exactly one row per document_id.
-- Supported on SQL Server 2005+.
-- =============================================================================

;WITH ranked_quotes AS (
    SELECT
        q.id,
        q.document_id,
        q.document_type,
        q.insured_name,
        q.insured_email,
        q.coverage_amt,
        q.premium,
        q.currency,
        q.status,
        q.effective_dt,
        q.expiry_dt,
        q.created_at,
        ROW_NUMBER() OVER (
            PARTITION BY q.document_id
            ORDER BY q.created_at DESC, q.id DESC   -- id breaks same-timestamp ties
        ) AS rn
    FROM quotes AS q
    INNER JOIN @target_docs AS t
        ON q.document_id = t.document_id
)
SELECT
    id,
    document_id,
    document_type,
    insured_name,
    insured_email,
    coverage_amt,
    premium,
    currency,
    status,
    effective_dt,
    expiry_dt,
    created_at
FROM ranked_quotes
WHERE rn = 1
ORDER BY document_id;


-- =============================================================================
-- INDEXING STRATEGY
-- =============================================================================

-- Primary composite index: covers the JOIN predicate and the ORDER BY
-- with a single index seek + range scan per document_id.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.quotes')
      AND name      = 'IX_quotes_document_id_created_at'
)
    CREATE INDEX IX_quotes_document_id_created_at
        ON dbo.quotes (document_id ASC, created_at DESC, id DESC);

-- Covering index: adds all projected columns as INCLUDE columns so the
-- engine can resolve the query entirely from the index (no key lookup).
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.quotes')
      AND name      = 'IX_quotes_document_id_created_at_covering'
)
    CREATE INDEX IX_quotes_document_id_created_at_covering
        ON dbo.quotes (document_id ASC, created_at DESC, id DESC)
        INCLUDE (document_type, insured_name, insured_email,
                 coverage_amt, premium, currency,
                 status, effective_dt, expiry_dt);

-- Filtered covering index: optimises the common case of querying APPROVED
-- quotes only. SQL Server filtered indexes require the filter column to be
-- NOT NULL or have a known value, so this is safe here.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.quotes')
      AND name      = 'IX_quotes_document_id_created_at_approved'
)
    CREATE INDEX IX_quotes_document_id_created_at_approved
        ON dbo.quotes (document_id ASC, created_at DESC, id DESC)
        INCLUDE (document_type, insured_name, insured_email,
                 coverage_amt, premium, currency, effective_dt, expiry_dt)
        WHERE status = 'APPROVED';


-- =============================================================================
-- PERFORMANCE NOTES
-- =============================================================================
-- 1. Populate @target_docs once per batch; do NOT insert inside a loop.
--
-- 2. The PRIMARY KEY on @target_docs.document_id gives the optimiser a
--    uniqueness guarantee and enables hash or merge join strategies.
--
-- 3. Analyse the execution plan:
--      SET STATISTICS IO, TIME ON;
--      <paste the query above here>
--      SET STATISTICS IO, TIME OFF;
--    Look for Index Seek operators on IX_quotes_document_id_created_at_covering.
--
-- 4. On very large tables (>10 M rows) consider scoping the filtered index
--    to recent rows using a computed persisted column for the year/month.
--
-- 5. UPDATE STATISTICS dbo.quotes; after bulk inserts to keep cardinality
--    estimates accurate for the query optimiser.
-- =============================================================================
