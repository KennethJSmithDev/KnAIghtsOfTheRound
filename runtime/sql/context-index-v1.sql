-- Run once in an operator-owned namespace after reviewing this schema.
-- Existing tables/indexes are not dropped or replaced by this migration.
CREATE TABLE KnAIghtsVector.CaseV1 (
  AuditId INTEGER NOT NULL,
  CaseId VARCHAR(32) NOT NULL,
  Disposition VARCHAR(32) NOT NULL,
  AuditJson VARCHAR(8192) NOT NULL,
  FactsJson VARCHAR(8192) NOT NULL,
  Features VECTOR(DOUBLE, 6) NOT NULL,
  CONSTRAINT UniqueSyntheticAudit UNIQUE (AuditId)
);

CREATE INDEX CaseV1HNSW ON TABLE KnAIghtsVector.CaseV1 (Features)
  AS HNSW(Distance='Cosine');
