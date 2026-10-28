---
title: "Teaching my Daikin ACs to cool the room, not the unit"
date: "2026-06-21"
updated: "2026-10-28"
description: "Daikin units regulate on their own sensor near the ceiling, so rooms never quite reach the temperature you asked for. Home Assistant now steers the setpoint from a real room sensor, and since autumn it also picks heating, cooling or off per room."
categories: ["smarthome"]
tags: ["home assistant", "smarthome"]
draft: true
---

My four Daikin Perfera split units have a maddening habit: each one regulates on its *own* return-air sensor, tucked up near the ceiling where warm air collects. So the unit happily reports "21 °C, we're done" while the actual room (measured by a Shelly H&T on the wall) is still 23. The result: rooms that never quite hit the temperature you asked for, and a thermostat you stop trusting.

Daikin's own fix (a field setting to offset the sensor) is **heating-only** on these units, and a fixed offset wouldn't help anyway: as you'll see, the error isn't constant. So I built the compensation in Home Assistant instead. Here's the design, the things that bit me, and how it held up through a summer and into the heating season.

## The core idea: drive the setpoint from a real sensor

Home Assistant can't tell a Daikin "regulate on this other sensor". The Onecta integration only *sends commands*. But you can exploit that: if the unit's internal sensor reads `ac_temp` and the real room is `room_temp`, then to make the **room** hit your desired temperature you just bias the setpoint by the difference:

```
target = desired + (ac_temp − room_temp)
```

A single template-driven automation does this every 15 minutes (and immediately when you change a desired-temp helper) for all four rooms. You set an `input_number` per room for the temperature you actually want; the automation translates it into the AC setpoint. Nothing else is allowed to touch the setpoint directly.

## The offset is *dynamic*, which is the whole point

Logging the offset (`ac_temp − room_temp`) per room revealed why a fixed value would never work:

| Room | offset range | character |
|---|---|---|
| A | **+1.1 constant** | reads steadily too warm |
| B | −0.4 … −1.4 | reads too cool, varies |
| C | −1.7 … **−2.8** | reads *way* too cool, erratic |
| D | −0.5 … +0.8 | flips sign |

Every unit is different, and several swing by 1–2 °C depending on whether the compressor is running. Dynamic compensation tracks that; a static offset can't.

## What bit me #1: the Onecta rate limit

The Daikin cloud allows ~200 API calls/day, **shared across every unit and both reads and writes**. My first version flapped: one room's setpoint oscillated 18 ↔ 18.5 ↔ 19 every cycle (39 writes in 9 hours, for a *single* room), which, combined with a 10-minute poll, drained the daily quota by midnight.

Two fixes:

1. **Slow the poll** to 30 min. Reads were eating ~150 of the 200 calls before a single write. Counter-intuitively this didn't hurt control, because the AC's internal sensor changes slowly and the *room* sensors live on separate, local integrations.
2. **A write deadband**: only push a new setpoint when it actually changes. An evaluation that needs no change now costs zero cloud calls, so the cadence can stay at 15 min safely.

Since then the counter rarely drops below ~70/day. Lesson: with a cloud HVAC API, *every* design decision is really a call-budget decision.

One more cloud quirk: a few times the Onecta integration simply froze, leaving every unit uncontrollable until I reloaded it by hand. A small watchdog automation now reloads the config entry when the rate-limit sensor has been unavailable for 15 minutes, and tells me it did.

## What bit me #2: getting the deadband right

A symmetric 1.0 deadband stopped the flapping but was too blunt to act on a real lag: one room sat at +1.2 because the wanted 0.5 °C drop was below threshold. My first fix was an **asymmetric deadband**: 0.5 when the setpoint needs to go down (room too warm, act now), 1.0 when it needs to go up (at or below target, don't fuss).

That turned out to be too clever. The 1.0 on the way up blocked the +0.5 corrections at night, so the bedroom and the office kept cooling to 1–1.4 °C *below* target, two nights in a row. Once the noise problem below was solved, a plain symmetric 0.5 no longer flapped:

```jinja
{{ (target - cur_set) | abs >= 0.5 }}
```

## What bit me #3: the unit's own sensor is noisy

The offset formula feeds the unit's internal reading straight into the setpoint. On a 34 °C day the office unit's sensor jumped by up to 3 °C, so its setpoint bounced along and at one point parked at 24–25: a cooling unit that doesn't cool. At night two other units jittered, causing bursts of writes that ate the Onecta budget.

The fix is a `statistics` sensor per room that takes the **median offset over the last 45 minutes**. A median ignores single spikes, so the setpoint follows the real, sustained bias. The compensation uses `room_temp + median_offset` as the unit's "effective" reading and falls back to the raw offset if the median is unavailable. The office setpoint went from 25 to 23 the moment I deployed it.

## What bit me #4: a single sensor is a single point of failure

I briefly ran one room purely on an IKEA air-quality monitor (it refreshes faster than the Shelly). Bad idea: it swung ±1.3 °C versus the Shelly, dropped offline for 1.5 hours (leaving the room unregulated), and once *spiked 3 °C*, which would have driven the AC to overcool the room based on a phantom reading.

The fix is sensor fusion with graceful degradation: average the sensors, ignore any that are unavailable.

```jinja
{% set ns = namespace(vals=[]) %}
{% for e in ['sensor.air_monitor_temperature', 'sensor.shelly_temperature'] %}
  {% set v = states(e) %}
  {% if v not in ['unknown', 'unavailable', '', 'none', none] %}
    {% set ns.vals = ns.vals + [v | float] %}
  {% endif %}
{% endfor %}
{{ (ns.vals | sum / ns.vals | length) | round(1) if ns.vals else states('sensor.shelly_temperature') }}
```

Now a spike is damped by the stable sensor, and a dropout just falls back to the other. The fast sensor's responsiveness without its fragility.

## A few more refinements

- **Gradual evening setback.** Dropping a bedroom from 21 → 19 in one step at 19:00 left it lagging all evening. Now it ramps in 0.5 °C steps to hit target by bedtime, so the unit's cooling ramps up smoothly instead of slamming a 2 °C gap.
- **Fan as escalation, not primary control.** The setpoint does ~95% of the work (over two days the fan left "quiet" only 17 times); it only steps up when a room genuinely can't keep up, with a bit of hysteresis so it doesn't hop between levels.
- **A linter as a guardrail.** With "the setpoint has exactly one owner" as the rule, I wrote a small Python linter (wired into pre-commit and CI) that fails the build if any automation calls `climate.set_temperature` on a room unit outside the compensation automation, or if a dashboard exposes a setpoint control for one. Future-me can't accidentally reintroduce a fight.

## Summer results

After two days of logging every 30 minutes in June:

| Room | mean error | within ±0.5 °C |
|---|---|---|
| A | +0.06 | 68% |
| B | −0.18 | 82% |
| C | −0.18 | **96%** |
| D | +0.22 | 71% |

Rooms held their target through 30 °C days, tightest during the day. The remaining wobble is mostly physics (an attic room swings with the sun, and a 19 °C deep-night target is genuinely hard to hit), not control error. Mean deviation sat near zero everywhere, which is the part that matters.

## Autumn: heating, and choosing the mode

In summer the question is only "how cold". In October the units have to decide *whether* to heat, cool or do nothing, and that turned out to be its own design problem.

**Compensation works both ways.** In heating mode the formula is the mirror image: below target, the setpoint goes up by the offset plus a proportional push; at or above target, the setpoint drops to whatever keeps the compressor idle.

**One owner for the mode, too.** Over the summer six different automations had grown that each switched units on or off: morning warm-up, evening cooling, a price-saving rule, holiday mode, and so on. They fought each other in exactly the way the setpoints used to. I replaced them with a single **mode controller** that runs every 15 minutes and picks heat, cool or off per room, with the reason written to the logbook. Its rules, roughly:

- Heat when the room is 0.5 °C below target, and keep heating until it reaches the target.
- Cool when the room is 0.5 °C above target.
- **Off is the resting state.** A unit that has had nothing to do for two hours goes from cool to off, instead of idling in cooling mode all night.
- Off when electricity is above €0.50/kWh or we're on holiday; cool when the price goes negative.
- If someone changes a unit by hand (app, remote, button), the controller leaves it alone for three hours.

**Two units, one outdoor unit.** My four indoor units hang off two outdoor units in pairs. Within a pair, one can't heat while the other cools: the unit with the "wrong" mode simply does nothing. I learned that when the bedroom wouldn't warm up because the room next door was set to cool. The controller now resolves this explicitly: if one room wants heat and the other doesn't really need cooling, the other goes off. If both genuinely want the opposite, the office wins during working hours, the bedroom at night, and otherwise the room with the biggest deviation.

**The heat-then-cool ping-pong.** The newest lesson is from this week. Heating stops at the target, cooling starts 0.5 °C above it, and a room keeps warming by another 0.3–0.5 °C after the heating stops. So one night the bedroom went heat → off → cool four times, with 9 °C outside. A rule that said "at least an hour in a mode before switching" didn't catch it, because every switch went through "off". The fix: after heating, no cooling for three hours (and vice versa), unless the room is more than 1.5 °C off.

The past week, with the units off most of the time and heating or cooling only when needed. The June tables above use the letters A–D; this one uses room names, because which room heats and which cools now matters:

| Room | mostly | mean error | within ±0.5 °C | within ±1.0 °C |
|---|---|---|---|---|
| Office | heating | +0.42 | 44% | 89% |
| Kid's room | cooling | +0.01 | **93%** | 99% |
| Bedroom | both | −0.13 | 74% | 93% |

Heating is the less precise direction: a room keeps warming after the heating stops, so the office tends to end up slightly above target. That's a trade-off I'm happy with in October.

## Takeaways

- You can make a cloud thermostat regulate on any sensor you like, as long as you only ever steer the **setpoint** and accept the API budget.
- Measure before you tune. The dynamic, per-unit offset is invisible until you log it, and it's the entire justification for the approach.
- For a metered cloud API, *not writing* is a feature. Deadbands and poll rate are first-class design parameters.
- Fuse your sensors, and smooth the ones you can't replace. A faster sensor is great until it lies or disappears.
- **Give every decision exactly one owner.** One automation owns the setpoint, one owns the mode. Most of my bugs came from two automations quietly fighting over the same unit.

The whole thing is a handful of template and statistics sensors and two automations. Home Assistant as the glue, as it should be.
