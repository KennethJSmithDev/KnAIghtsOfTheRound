# Synthetic HL7 observation editor

This local preview is for the KotR synthetic HL7 2.5 `ORU_R01` training
fixture. It changes a single `TX` observation's `OBX-5` and requires a new
`MSH-10`. Use the existing synthetic fixture or construct one with the same
sender, training mode, synthetic patient marker and MSH/PID/OBR/OBX layout.

```powershell
python scripts/hl7-sandbox.py synthetic.hl7 --text "Edited synthetic observation" --control-id KOTR-ORU-EDIT-001
```

The default prints the two field changes and the SHA-256 of each byte stream.
Add `--output synthetic-edited.hl7` to write a new file. The editor refuses
an existing destination and preserves the original bytes and segment
separator style. The new message control ID keeps the edit distinct from a
retry of the original message.

The preview performs structural checks for this one synthetic fixture
shape. IRIS still owns native HL7 parsing and the MLLP receipt and ACK. This
tool does not connect to an endpoint, send the message, edit the Management
Portal's Message Viewer, or validate clinical HL7 messages.


## Link a verified edit to its transport receipts

In an owned synthetic IRIS namespace with the health transport classes installed,
send the original and edited files separately through the local MLLP fixture.
An operator with `%Admin_Operate:U` and the `mllp-ingress` source grant can link
the two **committed** receipt IDs. Substitute the actual IDs from that fixture.

```objectscript
Set sc=##class(KnAIghts.Health.HL7EditReview).Link(originalId,editedId,.metadata)
Do $SYSTEM.Status.DisplayError(sc)
```

`Read(receiptId,.metadata)` returns the canonical link for the committed edit
or its identical retry. Both operations require the existing MLLP source grant.
IRIS checks the archived bytes and admits only the synthetic four-segment text
fixture whose edit changes MSH-10 and OBX-5. The link keeps the two receipt IDs
and hashes outside ER7. A rejected payload or an unrelated receipt cannot
inherit the link. It has no effect on MLLP ACKs or case approval.
