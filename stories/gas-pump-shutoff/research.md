# Research: how an automatic fuel nozzle shuts off

Status: verified against primary sources (patent text, manufacturer pages) on 2026-11-14. Every narrated claim maps to a source below. Anything not found in a source is listed under **Unverified** and is kept out of the narration.

## The mechanism, in the sources' own words

| # | Claim used in the episode | Status | Evidence |
|---|---|---|---|
| 1 | The shutoff is in the **nozzle**, not the pump | Verified | Every patent below is a *nozzle* patent; US 2,528,697: nozzles "commonly used at gasoline service stations for filling the tanks of automobiles" |
| 2 | There is a small **opening near the spout tip** | Verified (6 patents) | US 3,085,600: "a small tube having an outlet near the end of the spout"; US 2,582,195: opening "adjacent the outlet of the nozzle"; US 4,453,578: "an opening 41 in the spout 15 adjacent the discharge end"; US 3,603,359: "a fluid detector opening 22 at the lower end of the nozzle tube" |
| 3 | A **thin tube** runs from that opening up through the spout | Verified | US 3,085,600: tube 47, "the sensing tube", "extends downwardly through the spout 35 to a position near the spout end"; US 3,646,974: "a tube, which is disposed in a spout of the nozzle" |
| 4 | Flowing fuel through a **narrow spot (venturi)** creates suction | Verified | US 3,817,285: "a venturi effect is created by the flowing fluid to produce a partial vacuum within a chamber having a wall formed by a diaphragm"; US 2,582,195: "a ring 42 is mounted in the passageway below the valve seat"; US 3,085,600: "in most such structures, the Venturi means is located at the main valve" |
| 5 | While the hole is open, that suction just **pulls air in** through the hole | Verified | US 2,582,195 claim 1: "air is drawn from said orifice through the diaphragm chamber into said constricted passageway when fluid flows therethrough and said orifice is exposed"; US 3,085,600: "the suction is normally relieved by an in-flow of air" |
| 6 | When fuel **covers the hole**, air can't get in and the suction builds | Verified | US 3,646,974: "When the level of liquid in the tank … covers the opening in the spout for the tube, the orifice creates a suction in the diaphragm suction chamber"; US 2,582,195: "When opening 40 is submerged, air is evacuated from the diaphragm chamber" |
| 7 | The suction pulls a **flexible diaphragm** | Verified | US 2,582,195: "The diaphragm is actuated upwardly by suction"; US 3,085,600: "the vacuum … will draw the diaphragm 24 upwardly" |
| 8 | The diaphragm **pulls a pin** | Verified | US 2,582,195: "a pin 34 secured to the underside of the diaphragm"; US 3,817,285: "the diaphragm 50 has a latch retaining pin 56 secured thereto"; US 4,453,578: "the latch pin 45 is moved upwardly therewith" |
| 9 | A **latch lets go** (balls release the plunger) | Verified | US 3,817,285: "the balls 57 prevent downward movement of the plunger 58" … "the latch plunger 58 is released from the balls 57"; US 5,394,909 (Husky): "a series of latch balls 19, generally three in number" |
| 10 | The **lever drops / loses its pivot** | Verified | US 2,582,195: "said hand lever having a fulcrum carried by said plunger"; US 3,603,359: lever "pivotally connected at the pivot pin 76 to the plunger 68" … "causing a loss of the pivot 76" |
| 11 | A **spring snaps the main valve shut** | Verified (re-read verbatim: US 3,817,285 "a spring 17 continuously urges the first poppet valve 16 to its closed position in which flow from the inlet 11 to the outlet 12 is stopped") | US 2,582,195: "a main spring constantly urging said valve to closed position" … "the valve spring being adapted to close the main valve"; US 4,453,578: "a spring 18 … continuously urge the poppet valve 17 to its closed position" |
| 12 | "It's **not your car telling it to stop**" | Verified (nozzle sources) | The nozzle senses the full tank itself, at its own spout opening (rows 2–6). US 4,550,859 (Lockheed Electronics, 1985), verbatim: flow is "terminated in a conventional manner either automatically by nozzle sensing that the vehicle tank is full, or by a customer purposefully deactivating the pump nozzle." No source describes any signal from the vehicle |
| 13 | "The pump's **computer counts the cost**" | Verified (dispenser sources) | US 4,397,405 (Veeder Industries, 1983), verbatim: the meter drives "the cost and volume counters 36, 38 of a register 34 for registering or displaying the accumulated cost and volume amounts of fuel dispensed"; its control system "is an electronic microprocessor based system". US 4,550,859: the microprocessor console presents "dispensed fuel value and volume". **Nuance kept honest:** the electronics can also stop delivery at a *preset* amount (US 4,397,405: valves "closed … by the electronic control system 12, when the exact preset amount is reached"). That's why the script says "*Stopping at full* is pure mechanics", not "the shutoff" |
| 14 | "Stopping at full is **pure mechanics**" | Verified (nozzle sources) | The full-tank trip in every nozzle design read is mechanical: liquid covers the opening → venturi suction acts on the diaphragm → latch releases → spring closes the valve (US 3,646,974; US 2,582,195; US 3,817,285; US 2,528,697) |
| 15 | "When the tank's full, fuel **covers the hole**" | Verified (nozzle sources) | US 3,646,974, verbatim: "When the level of liquid in the tank being filled by the nozzle covers the opening in the spout for the tube, the orifice creates a suction in the diaphragm suction chamber to cause the main valve to be closed automatically". US 3,817,285: "When the fluid in the tank being filled reaches a predetermined level, the venturi effect produces an increased suction in the chamber so that the diaphragm moves." US 2,528,697: "closed by the rising liquid in the tank to be serviced." **The cutaway shows the fuel level rising to the spout tip, exactly as the patents describe; it does not show or explain vehicle tank venting** |

**Note (revision 4):** rows 12–14 support lines from revision 3 ("not your car", "the pump's computer", "pure mechanics") that are not in revision 4. They are kept as research.

**Correction (owner review).** Revision 2 cited vehicle fill-limit venting and ORVR material (a Saab service manual, Wikipedia's ORVR article, US 6,918,405) to support "fuel backs up over the hole". Those describe the **vehicle's** vapour and venting system, not the nozzle's automatic shutoff, so they can't validate the cutaway. They are removed as evidence, the narration line is replaced by the nozzle-sourced "fuel covers the hole", and no vehicle-side mechanism appears in the script or the visuals.

## Unverified: kept out of the narration
- **Hole size.** No source gives a size ("small tube" only). The script says "tiny", which is a description, not a measurement. Avoid "smaller than a pea" or any number.
- **What makes the click.** Real nozzles audibly click on shutoff (a common experience), but no source explains which part makes the sound. The episode uses the click as a sound cue and never explains it.
- **Tilt / attitude ball.** OPW mentions "FlowLock™ allows the nozzle to shut off when falling out of a vehicle and is tipped up", but describes no mechanism. Not mentioned.
- **Universality.** Other sensing principles exist: US 3,603,359 lists static pressure, float buoyancy and vapor pressure as alternatives. Vapor-recovery and vacuum-assist nozzles add parts. The script describes the common venturi design without saying "every nozzle".
- **Venturi position.** Designs differ: "at the main valve" (most designs, per US 3,085,600), "below the valve seat" (US 2,582,195), "at the forward end of the body" (US 3,085,600's own design). The cutaway places it just downstream of the main valve seat, and the narration only says "a narrow spot".
- **No-pressure/no-flow** (OPW 11B) and a second diaphragm for supply pressure (US 4,453,578) are real features, but outside this story. Not shown.
- Wikipedia's "venturi in the pump handle" wording conflicts with the patents, so the patents win. Not used as a source.

## Sources
**Patents** (full text opened at Google Patents):
- US 2,528,697: Logan & Lavallee, Gilbert & Barker, 1950. https://patents.google.com/patent/US2528697A/en
- US 2,582,195: Duerr, OPW Corp., 1952. https://patents.google.com/patent/US2582195A/en
- US 3,085,600: Briede, Dover Corp., 1963. https://patents.google.com/patent/US3085600A/en
- US 3,603,359: Belue, Gilbert & Barker, 1971. https://patents.google.com/patent/US3603359A/en
- US 3,646,974: Moore, Wilson & Wood, Dover Corp., 1972. https://patents.google.com/patent/US3646974A/en
- US 3,817,285: Wilder & Wood, Dover Corp., 1974. https://patents.google.com/patent/US3817285A/en
- US 4,453,578: Wilder, Dover Corp., 1984. https://patents.google.com/patent/US4453578A/en
- US 5,394,909: Mitchell & Fink, Husky Corp., 1995. https://patents.google.com/patent/US5394909A/en

**Dispenser electronics** (full text read at Google Patents; the verbatim quotes come from the first ~39k characters of each):
- US 4,397,405 "Valve shutoff system for fuel dispensing apparatus", Veeder Industries, 1983: https://patents.google.com/patent/US4397405A/en
- US 4,550,859 "Microprocessor controlled fluid dispensing system", Lockheed Electronics, 1985: https://patents.google.com/patent/US4550859A/en

**Removed as evidence** (vehicle venting, not nozzle shutoff): Wikipedia ORVR; Saab WIS ORVR refuelling page; US 6,918,405. US 10,679,456 is also no longer cited (it was never read in full).

**Manufacturer:**
- OPW 11A/11B automatic nozzles product page: https://www.opwglobal.com/products/us/retail-fueling-products/standard-dispensing-equipment/automatic-nozzles-gas-station/11a-and-11b-automatic-nozzles
- OPW 11A/11B instruction and troubleshooting PDFs: text partly extracted locally; the parts naming was consistent with the patents, but **we did not rely on them for any narrated claim**.

**Excluded** (not fuel nozzles): US 3,062,246 (tank fill valve), US 3,013,591 (aerosol filler head), US 4,130,146 (level gauge).

**Caveats:**
- Patents show how designs were invented and claimed, not necessarily today's exact products.
- The episode describes the shared principle, which all eight patents agree on, rather than a specific product.
- Product names (OPW, Husky) are research only and never appear on screen. The nozzle we model is generic and unbranded.

## Revision 4: line-by-line technical validation
Only nozzle-specific patents (rows 2–11 and 15 above) are used. Vehicle venting is not.

| Line (as written) | Verdict | Evidence / correction |
|---|---|---|
| "How does a gas pump know when to stop?" | OK (a question) | |
| "That click comes from a clever little mechanism inside the nozzle." | **Unsourced as written** | No source we read says which part makes the audible click (see Unverified, above). The shutoff itself is verified: US 3,646,974, "the main valve to be closed automatically to stop flow through the nozzle". **Minimal fix:** "That click? A clever little mechanism inside the nozzle just shut it off." This ties the click to the moment of shutoff, which is the viewer's real experience, without claiming its exact source |
| "See this tiny hole near the tip?" | Verified | Row 2: "an opening 44 in the spout 14" (US 3,817,285); "adjacent the discharge end of the spout" (US 4,453,578) |
| "While you're pumping, air gets sucked through it." | True, but **the cause is missing** | Air is drawn in *by the flowing fuel's venturi* (US 3,646,974: "the flow of the liquid … creates an orifice effect to suck the air from the atmosphere through the tube 35"). Without naming the cause, the later "the suction" has no source. **Minimal fix:** "While you're pumping, the rushing fuel sucks air in through it." This adds the venturi cause in three words |
| "But when gasoline rises high enough to cover the hole, that airflow stops." | Verified | US 3,646,974: "When the level of liquid in the tank being filled by the nozzle covers the opening in the spout…"; US 2,528,697: "closed by the rising liquid in the tank" |
| "Now the suction pulls on a diaphragm, releasing a spring-loaded valve." | Verified (simplified) | US 3,646,974: covering the opening makes "a suction in the diaphragm suction chamber"; US 2,528,697: "a flexible diaphragm … moved inwardly … when suction exists in said chamber". The diaphragm's pin frees the latch balls and plunger (US 3,817,285: "latch retaining pin 56 … three balls 57 … latch plunger 58"), and the main spring closes the valve (US 3,817,285: "a spring 17 continuously urges the first poppet valve 16 to its closed position"). "Releasing a spring-loaded valve" compresses latch → lever → spring into one phrase; **the visuals show the latch and lever steps explicitly** |
| "And the gas stops flowing. All because of that tiny hole." | Verified | The flow stops when the main valve closes; the trigger is the opening (rows 6 and 15) |

**Result:** the creative structure is kept. Two minimal wording changes are recommended, both measured in the timing preview (`narration.md`).
