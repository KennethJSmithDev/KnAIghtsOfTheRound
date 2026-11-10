package knaights.pex;

import com.intersystems.enslib.pex.BusinessOperation;
import java.util.Locale;

/**
 * Formats a related synthetic audit for a human reviewer. This Java PEX
 * component provides context only: IRIS retains all evidence and authority.
 */
public final class RelatedCaseOperation extends BusinessOperation {
    @Override public void OnInit() { }
    @Override public void OnTearDown() { }

    @Override
    public Object OnMessage(Object input) {
        if (!(input instanceof RelatedCase)) throw new IllegalArgumentException("Expected related synthetic case");
        RelatedCase request = (RelatedCase) input;
        if (!("synthetic-a".equals(request.caseId) || "synthetic-b".equals(request.caseId)))
            throw new IllegalArgumentException("Only synthetic cases are supported");
        if (request.auditId == null || !request.auditId.matches("[1-9][0-9]{0,9}"))
            throw new IllegalArgumentException("Invalid synthetic audit identifier");
        if (!("ACCEPTED".equals(request.disposition) || "REVIEW_REQUESTED".equals(request.disposition)))
            throw new IllegalArgumentException("Unsupported disposition");
        double score;
        try { score = Double.parseDouble(request.similarity); }
        catch (RuntimeException e) { throw new IllegalArgumentException("Invalid similarity", e); }
        if (!Double.isFinite(score) || score < 0 || score > 1.0000001)
            throw new IllegalArgumentException("Invalid similarity");
        RelatedCase result = new RelatedCase();
        result.caseId = request.caseId;
        result.auditId = request.auditId;
        result.disposition = request.disposition;
        result.similarity = request.similarity;
        result.formatVersion = "knaights-related-case-v1";
        result.summary = String.format(Locale.ROOT,
            "Related synthetic case %s, audit %s: %s (similarity %.3f). Context only; not an approval or a source ruling.",
            request.caseId, request.auditId, request.disposition, score);
        return result;
    }
}
