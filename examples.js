// Built-in gallery examples (keep this file as the single place to edit/add examples).
// - Used by app.js to render the Gallery "Examples" section.
// - Admin flow: "Copy standard example snippet" generates an entry you paste into this array.

export const GALLERY_EXAMPLES = [
  {
    id: "ex-01",
    title: "Starter (groups + multi-links)",
    dsl: `# Styles
Background: aliceblue
Default node colour: rgb(255, 224, 224)
Default node shape: rounded
Default node shadow: subtle
Default node border: 1px dashed seagreen
Direction: right-left
Label wrap: 20
Spacing along: 2
Spacing across: 2

# Contents
Title: Starter: change impacts
Description: Groups + multi-source/multi-target links, plus per-node styling.

## Nodes (and groups)
A:: New policy rollout[colour=red | border=1px solid blue]
--Outcomes
B:: Customer adoption
----Operational load
C:: Support tickets
--
F:: Budget constraint

P:: Training quality
Q:: Tool usability
D:: Process clarity
E:: Delivery speed

## Links
A -> B | C
Q -> D | E
P -> D 
P -> E [improves]`,
  },
  {
    id: "ex-02",
    title: "Top-bottom causal chain",
    dsl: `# Styles
Background: white
Default node colour: rgb(231, 245, 255)
Default node shape: rounded
Default node border: 1px solid dodgerblue
Default node shadow: subtle
Direction: top-bottom
Label wrap: 18
Spacing along: 6
Spacing across: 4

# Contents
Title: Simple chain
Description: Vertical top→bottom layout; labelled edges with label styling.

A:: Root cause
B:: Intermediate mechanism
C:: Outcome

A -> B [label=drives | border=gray | label style=italic | label size=10]
B -> C [leads to]`,
  },
  {
    id: "ex-03",
    title: "Left-right with implicit nodes",
    dsl: `# Styles
Background: floralwhite
Default node colour: wheat
Default node shape: rounded
Default node border: 1px dashed peru
Default node shadow: none
Direction: left-right
Label wrap: 22
Spacing along: 4
Spacing across: 3

# Contents
Title: Implicit nodes
Description: Implicit nodes created from quoted labels; mixed positive/negative links.

A:: Intervention A
B:: Measured outcome

A -> "Better compliance"
"Better compliance" -> B [improves | dashed peru]
A -> "Side effect risk" [increases | firebrick]
"Side effect risk" -> B [harms | firebrick]`,
  },
  {
    id: "ex-04",
    title: "Two drivers, one outcome",
      dsl: `Background: whitesmoke
Default node colour: gainsboro
Default node shape: rounded


Title: Drivers → outcomes
Description: Shows how to create multiple links: Cross-product using | on sources and targets, with simple clusters.

--Drivers
A:: Training quality
B:: Tool usability
--
--Outcomes
C:: Adoption
D:: Error rate
--

A | B -> C | D`,
  },
  {
    id: "ex-05",
    title: "Nested groups (2 levels)",
    dsl: `# Styles
Background: white
Default node colour: rgb(222, 245, 222)
Default node shape: rounded
Default node border: 1px dashed seagreen
Default node shadow: subtle
Direction: top-bottom
Label wrap: 20
Spacing along: 5
Spacing across: 3

# Contents
Title: Nested groups
Description: Two-level nesting with explicit group closing markers.

--Organisation
A:: Policy
----Team
B:: Habits
----  # end inner
--    # end outer
C:: Result

A -> B
B -> C [supports | dashed seagreen]`,
  },
  {
    id: "ex-06",
    title: "Feedback loop (conceptual)",
    dsl: `# Styles
Background: rgb(11, 16, 32)
Default node colour: rgb(31, 242, 168)
Default node shape: rounded
Default node border: 1px solid rgb(158, 197, 254)
Default node shadow: medium
Direction: left-right
Label wrap: 18
Spacing along: 4
Spacing across: 3

# Contents
Title: Reinforcing loop
Description: A small cycle (feedback loop) with a dark theme.

A:: Motivation
B:: Practice time
C:: Skill

A -> B [increases | rgb(158, 197, 254)]
B -> C [builds | rgb(158, 197, 254)]
C -> A [reinforces | rgb(158, 197, 254)]`,
},
{
    id: "ex-07",
    title: "Trade-offs (two outcomes)",
    dsl: `# Styles
Default node shape: rounded

# Contents
Title: Trade-offs
Description: One driver pushes outcomes in opposite directions (trade-off).

A:: Strict policy
B:: Compliance
C:: Flexibility

A -> B [increases | seagreen]
A -> C [decreases | firebrick]`,
  },
  {
    id: "ex-08",
    title: "Many-to-one (fan-in)",
    dsl: `# Styles
Background: white
Default node colour: mistyrose
Default node shape: rounded
Default node border: 1px dashed deeppink
Default node shadow: subtle
Direction: right-left
Label wrap: 17
Spacing along: 4
Spacing across: 3

# Contents
Title: Fan-in
Description: Fan-in: multiple causes converge on a single outcome.

A:: Staffing
B:: Process clarity
C:: Tooling
D:: Delivery speed

A | B | C -> D`,
  },
  {
    id: "ex-09",
    title: "Many-to-many (matrix)",
    dsl: `# Styles
Background: white
Default node colour: honeydew
Default node shape: rounded
Default node border: 1px solid seagreen
Default node shadow: subtle
Direction: top-bottom
Label wrap: 18
Spacing along: 4
Spacing across: 3

# Contents
Title: Cross-product
Description: Many-to-many cross-product with a shared edge label.

--Inputs
A:: Sleep
B:: Nutrition
C:: Exercise
--
--Outputs
D:: Mood
E:: Focus
--

A | B | C -> D | E [supports | seagreen]`,
  },
  {
    id: "ex-10",
    title: "Minimal monochrome",
    dsl: `# Styles
Background: white
Default node colour: white
Default node shape: rounded
Default node border: 1px solid black
Default node shadow: none
Direction: left-right
Label wrap: 22
Spacing along: 4
Spacing across: 3

# Contents
Title: Minimal
Description: Minimal monochrome styling (black/white).

A:: Hypothesis
B:: Evidence
C:: Conclusion

A -> B
B -> C`,
  },
  {
    id: "ex-11",
    title: "Warm palette",
    dsl: `# Styles
Background: bisque
Default node colour: peachpuff
Default node shape: rounded
Default node border: 1px solid chocolate
Default node shadow: subtle
Direction: left-right
Label wrap: 18
Spacing along: 4
Spacing across: 3

# Contents
Title: Warm palette
Description: Warm palette with dashed edges.

A:: Trigger
B:: Response
C:: Outcome

A -> B [causes | dashed chocolate]
B -> C [drives | dashed chocolate]`,
  },
  {
    id: "ex-12",
    title: "Cool palette + nested group",
    dsl: `# Styles
Background: rgb(231, 245, 255)
Default node colour: rgb(208, 235, 255)
Default node shape: rounded
Default node border: 1px solid dodgerblue
Default node shadow: subtle
Direction: top-bottom
Label wrap: 18
Spacing along: 5
Spacing across: 3

# Contents
Title: Cool palette
Description: Cool palette plus a nested group.

--System
A:: Input
----Module
B:: Processing
---- 
--
C:: Output

A -> B
B -> C`,
  },
  {
    id: "ex-13",
    title: "Two-layer map (overview + detail)",
    dsl: `# Styles
Background: white
Default node colour: whitesmoke
Default node shape: rounded
Default node border: 1px dashed dimgray
Default node shadow: none
Direction: left-right
Label wrap: 18
Spacing along: 5
Spacing across: 4

# Contents
Title: Overview vs detail
Description: Separate overview vs detail using clusters; multiple paths between them.

--Overview
A:: Strategy
B:: Delivery
--
--Detail
C:: Planning
D:: Execution
--

A -> B
A -> C
C -> D
D -> B`,
  },
  {
    id: "ex-14",
    title: "Risk controls",
    dsl: `# Styles
Background: white
Default node colour: rgb(255, 245, 245)
Default node shape: rounded
Default node border: 1px solid tomato
Default node shadow: subtle
Direction: left-right
Label wrap: 18
Spacing along: 4
Spacing across: 3

# Contents
Title: Risk control
Description: A control mitigates a risk; mixed edge styles and colours.

A:: Change volume
B:: Incident risk
C:: Review process
D:: Blast radius

A -> B [increases | tomato]
C -> B [reduces | seagreen]
C -> D [reduces | seagreen]
D -> B [increases | dashed tomato]`,
  },
  {
    id: "ex-15",
    title: "Resource constraint",
    dsl: `# Styles
Background: white
Default node colour: lavender
Default node shape: rounded
Default node border: 1px solid slateblue
Default node shadow: subtle
Direction: top-bottom
Label wrap: 19
Spacing along: 5
Spacing across: 3

# Contents
Title: Constraint
Description: Bottleneck/constraint dynamics: queues, lead time, throughput.

A:: Work in progress
B:: Queue size
C:: Throughput
D:: Lead time

A -> B [adds | slateblue]
B -> D [increases | slateblue]
C -> B [reduces | dashed slateblue]
D -> C [reduces | dashed slateblue]`,
  },
  {
    id: "ex-16",
    title: "Tiny map",
    dsl: `# Styles
Background: white
Default node colour: honeydew
Default node shape: rounded
Default node border: 1px solid seagreen
Default node shadow: none
Direction: left-right
Label wrap: 20
Spacing along: 4
Spacing across: 3

# Contents
Title: Tiny
Description: Smallest possible map.

A:: Cause
B:: Effect
A -> B`,
  },
  {
    id: "ex-17",
    title: "Maternal health (community health workers)",
    dsl: `# Styles
Background: white
Default node colour: rgb(231, 245, 255)
Default node shape: rounded
Default node border: 1px solid dodgerblue
Default node shadow: subtle
Direction: left-right
Label wrap: 20
Spacing along: 4
Spacing across: 3

# Contents
Title: CHWs → maternal & newborn health
Description: Realistic ToC with clusters and explicit constraints (health system + transport).

--Intervention
A:: Train & equip community health workers
B:: Home visits + counselling
--
--Mechanisms
C:: Knowledge of danger signs
D:: Birth preparedness
E:: Referral & care-seeking
--
--Health system constraints
F:: Facility readiness (staff, supplies)
G:: Transport access
--
--Outcomes
H:: Antenatal care attendance
I:: Skilled birth attendance
J:: Maternal & neonatal complications
--

A -> B [enables | dodgerblue]
B -> C | D [improves | dodgerblue]
C | D -> E [increases | dodgerblue]
E -> H | I [increases | dodgerblue]
H | I -> J [reduces | seagreen]
F -> H | I [limits | dashed tomato]
G -> E [limits | dashed tomato]`,
  },
  {
    id: "ex-18",
    title: "Cash transfers (poverty → schooling/health)",
    dsl: `# Styles
Background: white
Default node colour: rgb(245, 243, 255)
Default node shape: rounded
Default node border: 1px solid rebeccapurple
Default node shadow: subtle
Direction: top-bottom
Label wrap: 22
Spacing along: 5
Spacing across: 3

# Contents
Title: Cash transfers → household wellbeing
Description: Mediators + constraints, with a time-burden trade-off and payment reliability risk.

--Programme
A:: Targeting & enrolment
B:: Regular cash payments
C:: Messaging / conditions (if any)
--
--Household mechanisms
D:: Liquidity / consumption smoothing
E:: Reduced stress
F:: Ability to pay school costs
G:: Food security
--
--Risks & constraints
H:: Payment reliability
I:: Local prices / inflation
J:: Time burden (compliance)
--
--Outcomes
K:: School attendance
L:: Child nutrition
M:: Harmful coping (debt, child labour)
--

A -> B
B -> D [increases | rebeccapurple]
C -> J [may increase | dashed tomato]
D -> F | G [enables | rebeccapurple]
E -> K [supports | dashed rebeccapurple]
F -> K [increases | seagreen]
G -> L [improves | seagreen]
D -> M [reduces | seagreen]
H -> D [limits | dashed tomato]
I -> G [limits | dashed tomato]
J -> K [reduces | dashed tomato]`,
  },
  {
    id: "ex-19",
    title: "Teacher coaching (learning outcomes)",
    dsl: `# Styles
Background: white
Default node colour: rgb(236, 253, 245)
Default node shape: rounded
Default node border: 1px solid seagreen
Default node shadow: subtle
Direction: left-right
Label wrap: 20
Spacing along: 4
Spacing across: 3

# Contents
Title: Coaching → teaching quality → learning
Description: Education ToC with mediators and context constraints.

--Inputs
A:: Coach training + materials
B:: Classroom observation cycles
--
--Teacher mechanisms
C:: Teacher pedagogical knowledge
D:: Lesson planning quality
E:: Instructional practice (time on task)
--
--Classroom mediators
F:: Student engagement
G:: Formative assessment use
--
--Context constraints
H:: Class size
I:: Teacher absenteeism
J:: School leadership support
--
--Outcomes
K:: Learning (test scores)
--

A -> B [enables | seagreen]
B -> C | D [improves | seagreen]
C | D -> E [improves | seagreen]
E -> F | G [increases | seagreen]
F | G -> K [improves | seagreen]
H -> E [constrains | dashed tomato]
I -> E [reduces | dashed tomato]
J -> I [reduces | dashed seagreen]`,
  },
  {
    id: "ex-20",
    title: "WASH (sanitation + behaviour change)",
    dsl: `# Styles
Background: white
Default node colour: rgb(255, 245, 235)
Default node shape: rounded
Default node border: 1px solid peru
Default node shadow: subtle
Direction: left-right
Label wrap: 20
Spacing along: 4
Spacing across: 3

# Contents
Title: Sanitation → exposure → child health
Description: Infrastructure + behaviour change, with uptake/maintenance as critical mediators.

--Intervention
A:: Subsidies / financing for latrines
B:: Community-led behaviour change
C:: Supply chain for parts & repair
--
--Uptake & maintenance
D:: Latrine construction
E:: Consistent latrine use
F:: Functionality over time
--
--Exposure pathways
G:: Environmental contamination
H:: Pathogen exposure
--
--Outcomes
I:: Diarrhoeal disease
J:: Child growth (stunting)
--
--Constraints
K:: Water availability
L:: Social norms / enforcement
--

A -> D [increases | peru]
B -> E [increases | peru]
C -> F [supports | peru]
D -> E [enables | dashed peru]
E | F -> G [reduces | seagreen]
G -> H [reduces | seagreen]
H -> I [reduces | seagreen]
I -> J [improves | dashed seagreen]
K -> E [limits | dashed tomato]
L -> E [influences | dashed peru]`,
  },
  {
    id: "ex-21",
    title: "Social accountability (service delivery)",
    dsl: `# Styles
Background: white
Default node colour: rgb(245, 245, 245)
Default node shape: rounded
Default node border: 1px solid dimgray
Default node shadow: none
Direction: top-bottom
Label wrap: 22
Spacing along: 5
Spacing across: 3

# Contents
Title: Citizen feedback → service quality
Description: Governance pathway with risks/constraints; top→bottom layout.

--Programme
A:: Publish service standards & budgets
B:: Community scorecards / meetings
C:: Grievance channels + follow-up
--
--Mechanisms
D:: Citizen knowledge of entitlements
E:: Collective action
F:: Provider monitoring
G:: Provider incentives & accountability
--
--Context risks
H:: Elite capture / exclusion
I:: Fear of retaliation
J:: Administrative capacity
--
--Outcomes
K:: Provider responsiveness
L:: Service quality & access
--

A -> D [increases | dimgray]
B -> E [builds | dimgray]
C -> F [enables | dimgray]
D | E | F -> G [strengthens | dimgray]
G -> K [increases | seagreen]
K -> L [improves | seagreen]
H -> E [reduces | dashed tomato]
I -> C [reduces use | dashed tomato]
J -> K [limits | dashed tomato]`,
  },
];


