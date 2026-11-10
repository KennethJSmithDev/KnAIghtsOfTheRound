package knaights.pex;

import com.intersystems.enslib.pex.Message;

/** A synthetic, source-bound case returned by the IRIS similarity search. */
public final class RelatedCase extends Message {
    public String caseId;
    public String auditId;
    public String disposition;
    public String similarity;
    public String summary;
    public String formatVersion;
}
