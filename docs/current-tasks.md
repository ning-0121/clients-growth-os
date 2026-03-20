# CURRENT TASKS

## Order OS Improvements

1. Mobile UI fix
- Current issue: bad vertical layout
- Need responsive layout

2. Audit log system
- Track:
  - who
  - when
  - what action
- Store in:
  - milestone_logs
  - order_logs

3. Order creation flow update

NEW LOGIC:

At order creation:
- Required:
  - Customer PO upload
  - Basic order info

After finance approval:
- Within 2 days:
  - Production order upload (with BOM)

Later stage:
- Packaging info upload (not required initially)

---

## Constraints

- Do NOT redesign system
- Do NOT break existing flow
- Must follow execution logic already built

