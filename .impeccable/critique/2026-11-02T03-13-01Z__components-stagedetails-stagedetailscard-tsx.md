---
target: stage hover card
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/BPF-viewer/components/stageDetails/StageDetailsCard.tsx"
target_fingerprint: "sha256:d821e5a8689e11ca64df3207973ad3cda151faf821a55883498306fbccf203a0"
target_path: /home/user/BPF-viewer/components/stageDetails/StageDetailsCard.tsx
timestamp: 2026-11-02T03-13-01Z
slug: components-stagedetails-stagedetailscard-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent)

## Design Health Score: 25/40 (Acceptable)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Clear status/time/fill; completed stage "0/2 filled" unexplained; spinner jumps card height |
| 2 | Match system / real world | 3 | D365 terms; tile "Step 3" vs card "Steps" = fields; "(overdue)" without threshold |
| 3 | User control and freedom | 2 | Can't pin; keyboard can't enter card; hover-opened card ignores Escape |
| 4 | Consistency and standards | 3 | Status vocabulary drifts: Done/Completed, Step 3/Upcoming/inactive, Stopped/Stopped here/Aborted |
| 5 | Error prevention | 3 | Required-missing guard good; shows on aborted process; doesn't name the field |
| 6 | Recognition rather than recall | 3 | "+N more" not expandable; truncated values lack tooltip |
| 7 | Flexibility and efficiency | 1 | Read-only, no actions; 4 tab stops per row |
| 8 | Aesthetic and minimalist | 3 | Restrained; footer repeats row's process name; 3 dividers in 300px |
| 9 | Error recovery | 2 | Steps/values load failure disappears silently |
| 10 | Help and documentation | 2 | Overdue threshold & warning/danger split unexplained in card |

## Priority issues
1. [P1] Keyboard/screen-reader users can't read the card; hover-opened card ignores Escape (WCAG 1.4.13). -> harden
2. [P1] Card states untrue things: completed stage "0/2 filled", aborted "missing to move on", secured fields shown empty, cross-entity stages without values. -> clarify + data fixes
3. [P2] The blocker is buried below the list; orange warning bar reads as an error. -> layout
4. [P2] Silent load failure; spinner makes popover jump. -> harden
5. [P2] Terminology drift; 10px badges (detector: undersized-ui-text). -> clarify/typeset

## Detector
Source scan clean (misses tokens). Card-open CDP scan: 1 in-card finding (badge 10px, StageDetailsCard.tsx:282); text-occlusion x11 = false positives. Grid: undersized-ui-text x30, tiny-text x5, low-contrast x1 ("Stopped", opacity 0.75). Contrast in card: all text >=4.5; dark completed header icon 2.71:1 FAIL.
