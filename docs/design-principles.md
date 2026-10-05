> Imported into the repo on 2026-10-04 from the capstone planning folder
> (`Faculty Capstone Markdowns/Context/design-principles.md`). This is the broad
> set of frameworks the project drew on; not every section applies to Clarity
> Loop. The rules that are **binding** for this codebase are listed in
> [`CLAUDE.md`](../CLAUDE.md#design-rules-binding).

# Interface & App Design Frameworks
## Ontological, Emergent, and Virtue-Sensitive Learning Systems

---

## 1. Core Design Philosophy

This platform is not a tool for optimization or automation.

It is a **calibration instrument** that:
- Supports awareness over instruction
- Encourages emergence over control
- Prioritizes timing, posture, and relational intelligence

### Guiding Principles
- Subtle nudges over explicit interventions
- Reflection over reaction
- Embodied interaction over purely cognitive engagement
- Non-linear exploration over linear progression
- Presence over productivity

---

## 2. Calm Technology

### Core Idea
Technology should **inform without demanding attention**.

### Design Implications
- UI elements exist in the *periphery* until needed
- Minimal interruptions (no aggressive notifications)
- Ambient feedback (color, motion, sound) instead of alerts
- System presence is quiet and supportive

### Example Applications
- Subtle background gradients shifting with user pacing
- Passive indicators of engagement (not dashboards)
- Silence as a design element

### Source
- Mark Weiser & John Seely Brown (1995), *Designing Calm Technology*

---

## 3. Slow Technology

### Core Idea
Design for **reflection and mental rest**, not efficiency.

### Design Implications
- Introduce pauses and delays intentionally
- Avoid instant gratification loops
- Encourage contemplation over completion

### Example Applications
- Timed silence before interaction
- Questions without immediate answers
- Delayed feedback loops

### Source
- Hallnäs & Redström (2001), *Slow Technology*

---

## 4. Ambiguity as a Design Resource

### Core Idea
Ambiguity invites **interpretation, reflection, and personal meaning-making**.

### Design Implications
- Avoid over-explaining system behavior
- Allow multiple valid interpretations
- Present incomplete narratives or paradoxes

### Example Applications
- Open-ended prompts
- Contradictory signals in gameplay
- Abstract progress indicators

### Source
- Gaver, Beaver & Benford (2003), *Ambiguity as a Resource for Design*

---

## 5. Nudge-Based Interaction Design

### Core Idea
Guide behavior through **subtle environmental cues**, not instructions.

### Design Implications
- Preserve user autonomy
- Avoid coercion or direct instruction
- Design “choice architecture” that influences behavior gently

### Example Applications
- Highlighting overlooked options
- Gentle prompts (“Have you considered…?”)
- Timing-based cues instead of commands

### Source
- Thaler & Sunstein (2008), *Nudge Theory*

---

## 6. Non-Linear & Emergent Interaction Design

### Core Idea
Learning emerges through **exploration, not sequence**.

### Design Implications
- No fixed progression path
- Multiple entry points into problems
- Systems respond dynamically to user interaction

### Example Applications
- Exploratory problem spaces
- Dynamic branching scenarios
- No “correct path”

---

## 7. Mixed Reality & Real-World Integration

### Core Idea
The platform **augments reality**, rather than replacing it.

### Design Implications
- Use real-world context as part of the experience
- Blend digital prompts with physical environments
- Avoid fully immersive virtual isolation

### Example Applications
- AR overlays via mobile camera
- GPS-triggered prompts
- Real-world exploration tasks

---

## 8. Alternate Reality Games (ARGs)

### Core Idea
Blur the boundary between player and creator.

### Design Implications
- Players shape the experience through participation
- Narrative emerges through interaction
- Real-world and digital layers are intertwined

### Example Applications
- Location-based journaling boards
- Community-driven narrative fragments
- Distributed problem-solving

### Source
- Jagoda & Schilt (ARG research)
- Constructivist learning theory

---

## 9. Somaesthetic & Embodied Design

### Core Idea
Learning is **felt through the body**, not just understood cognitively.

### Design Implications
- Incorporate breath, posture, movement
- Use bodily awareness as feedback loop
- Design for sensory awareness

### Example Applications
- Breath-controlled UI (brightness, pace)
- Movement-based interaction
- Somatic prompts (“Pause. Notice your body.”)

### Source
- Kristina Höök, *Somaesthetic Design*

---

## 10. Biofeedback & Real-Time Sensing

### Core Idea
Use physiological signals to support awareness.

### Design Implications
- Feedback reflects state, does not diagnose
- Encourage self-awareness, not correction

### Example Applications
- Breath detection via camera
- Subtle UI shifts based on pacing
- Heart-rate or motion-based feedback

### Reference Implementation
- CV-based breathing detection:
  https://github.com/QiuZhaopeng/CV2_heartbeat_breathing_detection

---

## 11. Virtue-Centered Learning Environments

### Core Idea
Learning environments should cultivate **ethical and developmental growth**.

### Design Implications
- Embed value tensions into experiences
- Avoid moralizing or scoring virtue
- Let consequences reveal tradeoffs

### Core Virtue Axes
- Speed ↔ Care
- Power ↔ Humility
- Freedom ↔ Coherence
- Certainty ↔ Curiosity
- Agency ↔ Belonging

### Source
- Aretaic pedagogy research
- Aristotle (phronesis / practical wisdom)

---

## 12. Transformative Learning Theory

### Core Idea
Learning transforms **how we interpret reality**, not just what we know.

### Design Implications
- Introduce disorienting dilemmas
- Encourage critical reflection
- Support perspective shifts

### Example Applications
- Multi-perspective scenarios
- Reflective prompts post-experience
- Revisiting earlier decisions

### Source
- Jack Mezirow (Transformative Learning Theory)

---

## 13. Spiral & Cyclic Learning Models

### Core Idea
Learning deepens through **recursive revisiting**.

### Design Implications
- Reintroduce themes at higher complexity
- Enable reflection over time
- Track shifts in understanding

### Example Applications
- “Journaling back in time”
- Seasonal or cyclical challenges
- Iterative problem revisits

### Source
- Jerome Bruner, *Spiral Curriculum*

---

## 14. Harmonic Feedback Systems

### Core Idea
Learning is like **tuning an instrument**.

### Design Implications
- Feedback is experiential (visual, auditory)
- Encourage balance across perspectives
- Show integration vs fragmentation

### Example Applications
- Color harmonics representing perspective diversity
- Sound tones representing alignment
- Monotone vs complex patterns

---

## 15. Circadian & Seasonal Awareness

### Core Idea
Human cognition and emotion are **rhythmic**.

### Design Implications
- Adapt experiences to time of day
- Reflect seasonal cycles in design
- Respect cognitive energy fluctuations

### Example Applications
- Morning vs evening interaction differences
- Seasonal themes
- Energy-aware prompts

---

## 16. Collaborative Sense-Making (Stretch Goal)

### Core Idea
Understanding emerges through **shared reflection**.

### Design Implications
- Externalize thinking
- Support group mapping and dialogue
- Keep tools lightweight

### Example Applications
- Shared concept maps
- Sticky-note boards
- Perspective tagging

---

## Closing Principle

> The system does not teach answers.  
> It creates conditions where insight becomes unavoidable.

The platform succeeds when:
- It disappears into the background
- The user feels more aware, not more instructed
- The experience continues *after* the interaction ends