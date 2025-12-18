// Built-in gallery examples (keep this file as the single place to edit/add examples).
// - Used by app.js to render the Gallery "Examples" section.
// - Admin flow: "Copy standard example snippet" generates an entry you paste into this array.

export const GALLERY_EXAMPLES = [
  {
    id: "ex-01",
    title: "Starter (grouping boxes + multi-links)",
    desc: "A realistic starter map showing grouping boxes and multi-source/multi-target links.",
    dsl: `# Styles
Background: aliceblue
Default box colour: rgb(255, 224, 224)
Default box shape: rounded
Default box shadow: subtle
Default box border: 1px dotted seagreen
Direction: right-left
Label wrap: 20
Rank gap: 2
Node gap: 2

# Contents
Title: Starter: change impacts

## Nodes (and grouping boxes)
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
P | Q -> D | E
P -> E [improves | 1px solid]`,
  },
  {
    id: "ex-02",
    title: "Top-bottom causal chain",
    desc: "Simple chain with clearer vertical flow.",
    dsl: `# Styles
Background: white
Default box colour: rgb(231, 245, 255)
Default box shape: rounded
Default box border: 1px solid dodgerblue
Default box shadow: subtle
Direction: top-bottom
Label wrap: 18
Rank gap: 6
Node gap: 4

# Contents
Title: Simple chain

A:: Root cause
B:: Intermediate mechanism
C:: Outcome

A -> B [label=drives | border=1px solid gray | label style=italic | label size=10]
B -> C [leads to | 1px solid gray]`,
  },
  {
    id: "ex-03",
    title: "Left-right with implicit nodes",
    desc: "Edges can create nodes via free labels.",
    dsl: `# Styles
Background: floralwhite
Default box colour: wheat
Default box shape: rounded
Default box border: 1px dotted peru
Default box shadow: none
Direction: left-right
Label wrap: 22
Rank gap: 4
Node gap: 3

# Contents
Title: Implicit nodes

A:: Intervention A
B:: Measured outcome

A -> "Better compliance"
"Better compliance" -> B [improves | 1px dotted peru]
A -> "Side effect risk" [increases | 1px solid firebrick]
"Side effect risk" -> B [harms | 1px solid firebrick]`,
  },
  {
    id: "ex-04",
    title: "Two drivers, one outcome",
    desc: "Cross-product links using | on sources and targets.",
    dsl: `# Styles
Background: whitesmoke
Default box colour: gainsboro
Default box shape: rounded
Default box border: 1px solid gray
Default box shadow: subtle
Direction: left-right
Label wrap: 16
Rank gap: 4
Node gap: 3

# Contents
Title: Drivers → outcomes

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
    title: "Nested grouping boxes (2 levels)",
    desc: "Grouping boxes within grouping boxes to show structure.",
    dsl: `# Styles
Background: white
Default box colour: rgb(222, 245, 222)
Default box shape: rounded
Default box border: 1px dotted seagreen
Default box shadow: subtle
Direction: top-bottom
Label wrap: 20
Rank gap: 5
Node gap: 3

# Contents
Title: Nested grouping boxes

--Organisation
A:: Policy
----Team
B:: Habits
----  # end inner
--    # end outer
C:: Result

A -> B
B -> C [supports | 1px dotted seagreen]`,
  },
  {
    id: "ex-06",
    title: "Feedback loop (conceptual)",
    desc: "A small reinforcing loop.",
    dsl: `# Styles
Background: rgb(11, 16, 32)
Default box colour: rgb(31, 242, 168)
Default box shape: rounded
Default box border: 1px solid rgb(158, 197, 254)
Default box shadow: medium
Direction: left-right
Label wrap: 18
Rank gap: 4
Node gap: 3

# Contents
Title: Reinforcing loop

A:: Motivation
B:: Practice time
C:: Skill

A -> B [increases | 1px solid rgb(158, 197, 254)]
B -> C [builds | 1px solid rgb(158, 197, 254)]
C -> A [reinforces | 1px solid rgb(158, 197, 254)]`,
},
{
    id: "ex-07",
    title: "Trade-offs (two outcomes)",
    desc: "One cause pushes outcomes in opposite directions.",
    dsl: `# Styles
Default box shape: rounded

# Contents
Title: Trade-offs

A:: Strict policy
B:: Compliance
C:: Flexibility

A -> B [increases | 1px solid seagreen]
A -> C [decreases | 1px solid firebrick]`,
  },
  {
    id: "ex-08",
    title: "Many-to-one (fan-in)",
    desc: "Multiple causes converge on a single outcome.",
    dsl: `# Styles
Background: white
Default box colour: mistyrose
Default box shape: rounded
Default box border: 1px dotted deeppink
Default box shadow: subtle
Direction: right-left
Label wrap: 17
Rank gap: 4
Node gap: 3

# Contents
Title: Fan-in

A:: Staffing
B:: Process clarity
C:: Tooling
D:: Delivery speed

A | B | C -> D`,
  },
  {
    id: "ex-09",
    title: "Many-to-many (matrix)",
    desc: "Cross-product with edge label.",
    dsl: `# Styles
Background: white
Default box colour: honeydew
Default box shape: rounded
Default box border: 1px solid seagreen
Default box shadow: subtle
Direction: top-bottom
Label wrap: 18
Rank gap: 4
Node gap: 3

# Contents
Title: Cross-product

--Inputs
A:: Sleep
B:: Nutrition
C:: Exercise
--
--Outputs
D:: Mood
E:: Focus
--

A | B | C -> D | E [supports | 1px solid seagreen]`,
  },
  {
    id: "ex-10",
    title: "Minimal monochrome",
    desc: "A clean black/white style.",
    dsl: `# Styles
Background: white
Default box colour: white
Default box shape: rounded
Default box border: 1px solid black
Default box shadow: none
Direction: left-right
Label wrap: 22
Rank gap: 4
Node gap: 3

# Contents
Title: Minimal

A:: Hypothesis
B:: Evidence
C:: Conclusion

A -> B
B -> C`,
  },
  {
    id: "ex-11",
    title: "Warm palette",
    desc: "A warmer background and subtle dotted edges.",
    dsl: `# Styles
Background: bisque
Default box colour: peachpuff
Default box shape: rounded
Default box border: 1px solid chocolate
Default box shadow: subtle
Direction: left-right
Label wrap: 18
Rank gap: 4
Node gap: 3

# Contents
Title: Warm palette

A:: Trigger
B:: Response
C:: Outcome

A -> B [causes | 1px dotted chocolate]
B -> C [drives | 1px dotted chocolate]`,
  },
  {
    id: "ex-12",
    title: "Cool palette + nested grouping box",
    desc: "Cooler colours plus one nested grouping box.",
    dsl: `# Styles
Background: rgb(231, 245, 255)
Default box colour: rgb(208, 235, 255)
Default box shape: rounded
Default box border: 1px solid dodgerblue
Default box shadow: subtle
Direction: top-bottom
Label wrap: 18
Rank gap: 5
Node gap: 3

# Contents
Title: Cool palette

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
    desc: "Use clusters to separate overview and detail.",
    dsl: `# Styles
Background: white
Default box colour: whitesmoke
Default box shape: rounded
Default box border: 1px dotted dimgray
Default box shadow: none
Direction: left-right
Label wrap: 18
Rank gap: 5
Node gap: 4

# Contents
Title: Overview vs detail

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
    desc: "A map with a control mitigating a risk.",
    dsl: `# Styles
Background: white
Default box colour: rgb(255, 245, 245)
Default box shape: rounded
Default box border: 1px solid tomato
Default box shadow: subtle
Direction: left-right
Label wrap: 18
Rank gap: 4
Node gap: 3

# Contents
Title: Risk control

A:: Change volume
B:: Incident risk
C:: Review process
D:: Blast radius

A -> B [increases | 1px solid tomato]
C -> B [reduces | 1px solid seagreen]
C -> D [reduces | 1px solid seagreen]
D -> B [increases | 1px dotted tomato]`,
  },
  {
    id: "ex-15",
    title: "Resource constraint",
    desc: "A resource bottleneck affecting throughput.",
    dsl: `# Styles
Background: white
Default box colour: lavender
Default box shape: rounded
Default box border: 1px solid slateblue
Default box shadow: subtle
Direction: top-bottom
Label wrap: 19
Rank gap: 5
Node gap: 3

# Contents
Title: Constraint

A:: Work in progress
B:: Queue size
C:: Throughput
D:: Lead time

A -> B [adds | 1px solid slateblue]
B -> D [increases | 1px solid slateblue]
C -> B [reduces | 1px dotted slateblue]
D -> C [reduces | 1px dotted slateblue]`,
  },
  {
    id: "ex-16",
    title: "Tiny map",
    desc: "The smallest possible example.",
    dsl: `# Styles
Background: white
Default box colour: honeydew
Default box shape: rounded
Default box border: 1px solid seagreen
Default box shadow: none
Direction: left-right
Label wrap: 20
Rank gap: 4
Node gap: 3

# Contents
Title: Tiny

A:: Cause
B:: Effect
A -> B`,
  },
  {
    id: "ex-17",
    title: "Maternal health (community health workers)",
    desc: "Classic pathway: outreach → knowledge/behaviour → service use → health outcomes, with constraints.",
    dsl: `# Styles
Background: white
Default box colour: rgb(231, 245, 255)
Default box shape: rounded
Default box border: 1px solid dodgerblue
Default box shadow: subtle
Direction: left-right
Label wrap: 20
Rank gap: 4
Node gap: 3

# Contents
Title: CHWs → maternal & newborn health

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

A -> B [enables | 1px solid dodgerblue]
B -> C | D [improves | 1px solid dodgerblue]
C | D -> E [increases | 1px solid dodgerblue]
E -> H | I [increases | 1px solid dodgerblue]
H | I -> J [reduces | 1px solid seagreen]
F -> H | I [limits | 1px dotted tomato]
G -> E [limits | 1px dotted tomato]`,
  },
  {
    id: "ex-18",
    title: "Cash transfers (poverty → schooling/health)",
    desc: "Income support shifts household constraints; shows trade-offs and implementation quality.",
    dsl: `# Styles
Background: white
Default box colour: rgb(245, 243, 255)
Default box shape: rounded
Default box border: 1px solid rebeccapurple
Default box shadow: subtle
Direction: top-bottom
Label wrap: 22
Rank gap: 5
Node gap: 3

# Contents
Title: Cash transfers → household wellbeing

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
B -> D [increases | 1px solid rebeccapurple]
C -> J [may increase | 1px dotted tomato]
D -> F | G [enables | 1px solid rebeccapurple]
E -> K [supports | 1px dotted rebeccapurple]
F -> K [increases | 1px solid seagreen]
G -> L [improves | 1px solid seagreen]
D -> M [reduces | 1px solid seagreen]
H -> D [limits | 1px dotted tomato]
I -> G [limits | 1px dotted tomato]
J -> K [reduces | 1px dotted tomato]`,
  },
  {
    id: "ex-19",
    title: "Teacher coaching (learning outcomes)",
    desc: "Education ToC: professional development → practice change → learning, moderated by context.",
    dsl: `# Styles
Background: white
Default box colour: rgb(236, 253, 245)
Default box shape: rounded
Default box border: 1px solid seagreen
Default box shadow: subtle
Direction: left-right
Label wrap: 20
Rank gap: 4
Node gap: 3

# Contents
Title: Coaching → teaching quality → learning

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

A -> B [enables | 1px solid seagreen]
B -> C | D [improves | 1px solid seagreen]
C | D -> E [improves | 1px solid seagreen]
E -> F | G [increases | 1px solid seagreen]
F | G -> K [improves | 1px solid seagreen]
H -> E [constrains | 1px dotted tomato]
I -> E [reduces | 1px dotted tomato]
J -> I [reduces | 1px dotted seagreen]`,
  },
  {
    id: "ex-20",
    title: "WASH (sanitation + behaviour change)",
    desc: "Infrastructure plus social norms; includes uptake and maintenance as critical links.",
    dsl: `# Styles
Background: white
Default box colour: rgb(255, 245, 235)
Default box shape: rounded
Default box border: 1px solid peru
Default box shadow: subtle
Direction: left-right
Label wrap: 20
Rank gap: 4
Node gap: 3

# Contents
Title: Sanitation → exposure → child health

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

A -> D [increases | 1px solid peru]
B -> E [increases | 1px solid peru]
C -> F [supports | 1px solid peru]
D -> E [enables | 1px dotted peru]
E | F -> G [reduces | 1px solid seagreen]
G -> H [reduces | 1px solid seagreen]
H -> I [reduces | 1px solid seagreen]
I -> J [improves | 1px dotted seagreen]
K -> E [limits | 1px dotted tomato]
L -> E [influences | 1px dotted peru]`,
  },
  {
    id: "ex-21",
    title: "Social accountability (service delivery)",
    desc: "Governance ToC: information + collective action → responsiveness → better services.",
    dsl: `# Styles
Background: white
Default box colour: rgb(245, 245, 245)
Default box shape: rounded
Default box border: 1px solid dimgray
Default box shadow: none
Direction: top-bottom
Label wrap: 22
Rank gap: 5
Node gap: 3

# Contents
Title: Citizen feedback → service quality

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

A -> D [increases | 1px solid dimgray]
B -> E [builds | 1px solid dimgray]
C -> F [enables | 1px solid dimgray]
D | E | F -> G [strengthens | 1px solid dimgray]
G -> K [increases | 1px solid seagreen]
K -> L [improves | 1px solid seagreen]
H -> E [reduces | 1px dotted tomato]
I -> C [reduces use | 1px dotted tomato]
J -> K [limits | 1px dotted tomato]`,
  },
];


