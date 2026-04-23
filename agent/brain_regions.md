# Brain Region Reference for Video Prompt Design

This file maps HCP-MMP1 brain regions to their functions and the visual content that drives them. Use it when designing keyframe prompts and motion prompts to target specific regions, and when interpreting score.json region_deltas to decide what to change.

Region names here are the exact strings used in score.json and target_state.json.

---

## Fine networks (22 groups — Glasser 2016)

### Primary Visual
**Regions:** V1  
**Function:** Edge detection, orientation, spatial frequency. The earliest cortical stage of vision — it fires to any visual input.  
**Drive with:** High-contrast edges, fine textures, flickering patterns, sharp gradients, grid-like structures. Even a blurry frame activates V1 weakly; to maximize it, use images with extreme spatial frequency content.

---

### Early Visual
**Regions:** V2, V3, V4  
**Function:** Color, shape, and local feature processing. V4 is specifically tuned to color and curved forms.  
**Drive with:** Rich color variety, saturated hues, curved geometric shapes, patterned surfaces. Abstract art, kaleidoscopic visuals, vivid natural colors (flowers, coral reefs, aurora).

---

### Dorsal Stream Visual
**Regions:** V3A, V3B, V6, V6A, V7, IPS1  
**Function:** Spatial location, visuomotor coordination, attention to spatial structure. Part of the "where" pathway.  
**Drive with:** Wide-field spatial layouts, depth cues, parallax, structured environments with clear spatial relationships. Architectural wide shots, aerial views of grids or landscapes.

---

### Ventral Stream Visual
**Regions:** V8, VVC, PIT, FFC, VMV1, VMV2, VMV3  
**Function:** Object and scene recognition, visual memory. The "what" pathway — recognizing what things are.  
**Drive with:** Recognizable objects, faces, animals, scenes with identifiable content. Clear, well-lit subjects against neutral backgrounds. Photography-style compositions.

---

### MT+ Complex and Neighboring Areas
**Regions:** V3CD, LO1, LO2, LO3, V4t, FST, MT, MST, PH  
**Function:** Motion detection, optical flow, moving object tracking. MT is the primary motion area — it fires strongly to any directional movement in the visual field.  
**Drive with:** Fast camera motion, panning, tracking shots, flowing water, wind in trees, crowds moving, drone footage, time-lapses with movement, particle effects. The faster and more coherent the motion direction, the stronger the response.

---

### Somatosensory and Motor
**Regions:** 4, 3a, 3b, 1, 2  
**Function:** Body sensation and motor cortex — activated by watching body movements, especially hands and face.  
**Drive with:** Close-up shots of hands manipulating objects, people walking or gesturing, physical effort scenes (athletes, craftspeople), tactile textures that imply touch.

---

### Paracentral Lobular and Mid-Cingulate
**Regions:** 24dd, 24dv, 6mp, 6ma, SCEF, 5m, 5L, 5mv  
**Function:** Supplementary motor area, voluntary movement preparation, effort and control.  
**Drive with:** Purposeful, deliberate movement — slow intentional actions rather than passive motion. A hand carefully placing an object, a person steadying themselves.

---

### Premotor
**Regions:** 55b, 6d, 6a, FEF, 6v, 6r, PEF  
**Function:** Action planning, eye movement control (FEF = Frontal Eye Fields), preparation for movement.  
**Drive with:** Dynamic scenes that imply imminent action, quick cuts between objects of interest, scenes that demand tracking attention.

---

### Posterior Opercular
**Regions:** 43, FOP1, OP4, OP1, OP2-3, PFcm  
**Function:** Somatosensory integration, mouth/face sensation, pain processing.  
**Drive with:** Faces eating, mouths speaking, close-ups of facial expressions involving the lower face. Less useful for pure visual targeting.

---

### Early Auditory
**Regions:** A1, LBelt, MBelt, PBelt, RI  
**Function:** Primary auditory cortex. **Note: video-only sessions cannot directly target this network** — these regions respond to sound, not vision. They may activate weakly via multisensory integration but are not reliably targetable through visual content alone.

---

### Auditory Association
**Regions:** A4, A5, STSdp, STSda, STSvp, STSva, STGa, TA2  
**Function:** Speech perception, language processing, audiovisual integration. STS (Superior Temporal Sulcus) is strongly activated by moving mouths, biological motion, and socially meaningful actions.  
**Drive with:** Faces talking or singing (mouth movement), people gesturing as if speaking, biological motion that implies social communication. The STS is one of the most reliable targets through visual content alone.

---

### Insular and Frontal Opercular
**Regions:** 52, PI, Ig, PoI1, PoI2, FOP2, FOP3, MI, AVI, AAIC, Pir, FOP4, FOP5  
**Function:** Interoception, emotional salience, disgust, pain, body state awareness.  
**Drive with:** Visceral or emotionally intense imagery, extreme close-ups of skin or body, uncomfortable or awe-inducing scenes. Difficult to target reliably with neutral content.

---

### Medial Temporal
**Regions:** H, PreS, EC, PeEc, PHA1, PHA2, PHA3  
**Function:** Scene recognition, spatial navigation, memory encoding. PHA (Parahippocampal Area) is strongly activated by scenes of places — the more navigable and spatially coherent the environment, the stronger the response.  
**Drive with:** Indoor and outdoor environments you could navigate through — hallways, streets, forests, rooms. Establishing shots showing the spatial layout of a place. Architecture, landscape photography, fly-through footage of environments.

---

### Lateral Temporal
**Regions:** PHT, TE1p, TE1m, TE1a, TE2p, TE2a, TGv, TGd, TF  
**Function:** Semantic memory, object knowledge, conceptual processing. These regions recognize categories of things (tools, animals, vehicles) and link visual input to meaning.  
**Drive with:** Objects and scenes with clear semantic identity — a kitchen full of utensils, a workshop, a library. Content where the viewer instantly knows "what this is for."

---

### Temporo-Parieto-Occipital Junction
**Regions:** TPOJ1, TPOJ2, TPOJ3, STV, PSL  
**Function:** Biological motion perception (STV = Superior Temporal Visual area), body perception, social perception. STV responds specifically to the sight of a living body moving.  
**Drive with:** People and animals moving naturally — walking, running, dancing, animal locomotion. Point-light displays (motion capture-style) or silhouettes of biological motion work especially well.

---

### Superior Parietal
**Regions:** LIPv, LIPd, VIP, AIP, MIP, 7PC, 7AL, 7Am, 7PL, 7Pm  
**Function:** Spatial attention, visuomotor integration, reaching and grasping actions, multisensory spatial maps.  
**Drive with:** Scenes requiring active spatial tracking — multiple moving objects, 3D environments with depth, scenes where you track an object through space. First-person navigation footage.

---

### Inferior Parietal
**Regions:** PGp, PGs, PGi, PFm, PF, PFt, PFop, IP0, IP1, IP2  
**Function:** Integration of sensory information, number processing, language comprehension (angular gyrus), attention reorienting.  
**Drive with:** Cluttered but meaningful scenes, multiple distinct objects to track, scenes with implied narrative context that demands interpretation.

---

### Posterior Cingulate
**Regions:** DVT, ProS, POS1, POS2, RSC, v23ab, d23ab, 31pv, 31pd, 31a, 23d, 23c, PCV, 7m  
**Function:** RSC (Retrosplenial Cortex) is critical for spatial navigation and scene memory. The broader posterior cingulate is part of the Default Mode Network — it's active during mind-wandering, self-referential thought, and recollection.  
**Drive with:** Familiar-feeling or landmark-rich environments (RSC), introspective or emotionally resonant scenes, nostalgic imagery, slow contemplative shots of meaningful places.

---

### Anterior Cingulate and Medial Prefrontal
**Regions:** 33pr, p24pr, a24pr, p24, a24, p32pr, a32pr, d32, p32, s32, 8BM, 9m, 10v, 10r, 25  
**Function:** Emotional regulation, conflict monitoring, self-referential processing, social cognition, reward.  
**Drive with:** Emotionally charged social scenes, moments of human connection or conflict, first-person perspective shots that imply self-involvement, faces expressing strong emotions.

---

### Orbital and Polar Frontal
**Regions:** 47s, 47m, a47r, 11l, 13l, a10p, p10p, 10pp, 10d, OFC, pOFC  
**Function:** Reward valuation, pleasantness, taste/smell integration, decision-making about outcomes.  
**Drive with:** Appealing, reward-associated imagery — beautiful food, pleasant environments, scenes associated with positive outcomes. The orbitofrontal cortex is sensitive to aesthetic beauty and reward cues.

---

### Inferior Frontal
**Regions:** 44, 45, IFJp, IFJa, IFSp, IFSa, 47l, p47r  
**Function:** Broca's area (language production), semantic retrieval, cognitive control.  
**Drive with:** Language-related scenes (people speaking, writing, reading — but remember no text survives video generation), complex tasks requiring rule-following, social problem-solving scenes.

---

### Dorsolateral Prefrontal
**Regions:** 8C, 8Av, i6-8, s6-8, SFL, 8BL, 9p, 9a, 8Ad, p9-46v, a9-46v, 46, 9-46d  
**Function:** Working memory, cognitive flexibility, top-down attention control, planning.  
**Drive with:** Complex scenes with multiple elements to track simultaneously, scenes that evolve over time requiring memory of prior state, strategic or puzzle-like visual content.

---

## Coarse networks (7 groups — Yeo 2011)

| Network | Key regions | Best visual content |
|---|---|---|
| **Visual** | V1–V4, MT, MST, FFC, PHA1-3 | Any rich visual scene; motion and color for maximum coverage |
| **Somatomotor** | M1, S1, A1, premotor | Body movement, hands-on tasks, mouth movement |
| **Dorsal Attention** | FEF, IPS, LIP, VIP | Spatial tracking, multiple moving objects, eye-demanding scenes |
| **Ventral Attention** | Frontal operculum, insula | Surprising or salient events, emotional/bodily salience |
| **Limbic** | OFC, entorhinal, temporal pole | Reward, pleasant environments, familiar/comforting imagery |
| **Frontoparietal** | DLPFC, IPS, IFJ | Complex multi-object scenes, cognitive challenge |
| **Default** | RSC, STS, mPFC, angular gyrus | Narrative, social scenes, contemplative/introspective content |

---

## Quick targeting cheat sheet

| You want to drive... | Use this visual content |
|---|---|
| Deep visual immersion | Ultra-high detail natural scenes, extreme textures, rich color |
| Sense of motion / flow | Fast camera movement, flowing water, wind, particle motion |
| Social presence | Human faces, biological motion, people interacting |
| Spatial navigation | Navigable environments, architectural interiors, landscapes |
| Calm / default mode | Slow contemplative shots, familiar places, soft light |
| Alertness / attention | Multiple moving objects, dynamic complex scenes |
| Emotional resonance | Expressive faces, charged human moments, reward cues |
