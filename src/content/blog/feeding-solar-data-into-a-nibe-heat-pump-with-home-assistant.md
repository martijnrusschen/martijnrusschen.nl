---
title: "Feeding solar data into a NIBE heat pump with Home Assistant (no EME 20 needed)"
date: "2026-10-28"
description: "NIBE wants a €400 EME 20 module to read your solar inverter. I made Home Assistant pretend to be a SunSpec inverter instead, complete with grid meter and home battery."
categories: ["smarthome"]
tags: ["home assistant", "smarthome"]
---

My NIBE S320 indoor unit with an S2125 heat pump can use surplus solar energy to heat hot water. NIBE's way to get that information into the heat pump is the EME 20: a €400 module that sits in the heat pump and talks to your solar inverter over RS485.

That didn't work for me anyway. My solar panels and home battery are from Zonneplan, and their inverters only report to the Zonneplan cloud. Home Assistant already has all of that data, though: PV production from the Zonneplan integration, the grid from my YouLess P1 reader, and the battery from Zonneplan again.

So the question was: can Home Assistant play the part of the solar inverter? It can. This post describes how I got there, including the dead ends.

## What the NIBE can read

Recent S-series firmware has a menu **7.5.12 Modbus TCP/IP accessories**. Turn on **Modbus PV** in 7.5.12.1, and 7.5.12.2 lets you add an inverter of type **SunSpec**, with an IP address, port and unit ID.

SunSpec is an open standard for how inverters, energy meters and batteries expose their data over Modbus. If something on the network answers like a SunSpec inverter, the NIBE will read it. It doesn't care what's behind it.

## Dead end 1: the "EME20 API" registers

Before I found the SunSpec option, I went through the Modbus registers the `nibe_heatpump` integration exposes. There's a set called **EME20 API** (42108 to 42110) that lets you write the available solar power directly.

A few lessons from that:

- **Don't turn on register 44001 ("EME20").** That tells the heat pump an EME 20 module is installed. It immediately looks for it on its internal bus and raises a communication alarm. Turning it off again cleared the alarm.
- With Modbus PV on, 42108 (API on) plus 42110 (available power) works without the module. **42110 is in steps of 10 W**, so 4 kW is 400.
- The NIBE shows that value as **surplus**, not production. I would have had to calculate the real surplus myself. With a home battery that trades on the energy market that turns out to be nearly impossible (more on that below).
- The moment you add a SunSpec inverter, the NIBE turns the API off by itself. It's one or the other.

## Building a SunSpec inverter as a Home Assistant add-on

The add-on is about 300 lines of Python using `pymodbus`. Every 10 seconds it reads the values from the Home Assistant API, and it serves this register map on port 502:

| Address | SunSpec model | Content | Source |
|---|---|---|---|
| 40000 | header | `SunS` | fixed |
| 40002 | 1 (common) | manufacturer, model, serial | fixed |
| 40070 | 103 (three-phase inverter) | AC power, lifetime energy, status | Zonneplan inverters |
| 40122 | 203 (three-phase meter) | grid power per phase, voltage, import/export counters | YouLess |
| 40229 | 124 (storage) | state of charge, charging status | Zonneplan battery |
| 40255 | 160 (MPPT) | PV as a single DC string | Zonneplan inverters |
| 40285 | end marker | `0xFFFF, 0` | fixed |

The add-on config is short. `host_network` makes port 502 reachable on the Home Assistant IP, and `homeassistant_api` gives the add-on a token for the Core API:

```yaml
name: SunSpec emulator
version: "0.2.2"
slug: sunspec_emulator
arch:
  - amd64
startup: application
boot: auto
init: false
host_network: true
homeassistant_api: true
options:
  port: 502
  pv_power: sensor.zonneplan_combined_last_measured_value
  grid_power: sensor.power_usage
  battery_soc: sensor.thuisbatterij_percentage
  # ...plus the energy counters and phase sensors
```

The core of the server:

```python
block = ModbusSequentialDataBlock(BASE + 1, initial_registers())
slave = ModbusSlaveContext(hr=block, ir=block)
ctx = ModbusServerContext(slaves=slave, single=True)
asyncio.create_task(updater(ctx, opts))   # refreshes the values every 10 s
await StartAsyncTcpServer(context=ctx, address=("0.0.0.0", opts["port"]))
```

Before I let the heat pump near it, I tested the server with [pysunspec2](https://github.com/sunspec/pysunspec2), the official SunSpec client library. If that scans all models and returns the right values, a real SunSpec client will too.

### Gotchas I ran into

- **pymodbus adds 1 to every address.** In pymodbus 3.8 the `zero_mode` option is gone. The data block has to start at 40001 for `SunS` to show up at protocol address 40000.
- **The Supervisor token wasn't there.** The add-on base images start your program through s6, and the program didn't get `SUPERVISOR_TOKEN`. `ENTRYPOINT []` in the Dockerfile fixed it.
- **`BUILD_FROM` is no longer filled in for local add-ons.** Give it a default in the Dockerfile (`ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20`); `build.yaml` is deprecated.
- **The NIBE shows the energy counter as "this month".** It displayed the lifetime total of 29,872 kWh as October. I now report the counter minus its value on October 1st.
- **Stale values must never stay "live".** If the PV sensor hasn't updated in 20 minutes, the add-on reports 0 W and status "sleeping". I'd rather the heat pump miss some sun than run on a value from this morning.

### Let the device tell you what it reads

PV production showed up right away. But after I added the battery model, the sun icon on the NIBE changed to "no flow". It took me a while to understand why.

What helped was logging every read request in the add-on. The log showed exactly which registers the NIBE requests, and in which order.

With a storage model present, the NIBE treats the device as a **hybrid inverter**. Hybrid inverters report the panels separately in model 160 (DC power per MPPT string), and that block was missing. I added it at the end of the chain, so the meter and battery kept their addresses, and the sun came back.

## Why the grid comes from the YouLess, not Zonneplan

Zonneplan also reports grid power from its own P1 dongle, and all Zonneplan values update in the same batch. That sounds like the cleanest source, so I tested it against a week of history. At every battery update, I computed house consumption as solar + grid − battery:

| Grid source | House below 0 W (impossible) | House above 5 kW |
|---|---|---|
| Zonneplan P1 | 18.5% | 18.2% |
| YouLess (local, every 10 s) | 8.5% | 8.4% |

The Zonneplan grid value often doesn't drop back to zero. In 43% of the samples it reported import and export at the same time. On top of that, the battery swings between +11 and −11 kW within minutes for energy trading, while its cloud value updates every 5 minutes at best. So even "the same batch" doesn't mean the same moment.

This is also why a home-made "real surplus" calculation didn't work. Letting the NIBE see the live grid meter and decide for itself is the more honest setup.

## The result

The NIBE now shows the full picture on its **Energy supply** screen: solar, grid, house, heat pump and battery, with flows that add up. In menu 4.2.2 I let solar affect **hot water only**, with heat source **compressor only**, and the energy meter set to **smart meter**. Floor heating stays under its own Home Assistant automation.

Floor heating and the air conditioners each have their own controller, and each decision has exactly one owner. The air conditioners are a story of their own: [Teaching my Daikin ACs to cool the room, not the unit](/teaching-my-daikin-acs-to-cool-the-room-not-the-unit/).

I liked that screen enough to build the same diagram for the wall tablet in Home Assistant: a `button-card` with an inline SVG and animated dots in the direction of the flow.

## Caveats

- **Battery trading looks like surplus.** When Zonneplan sells battery energy to the grid, the NIBE sees export and may heat water with battery power. I'm watching how often that happens. If needed, the add-on can subtract battery discharge from the export it reports.
- **The NIBE needs a fixed IP.** Give your Home Assistant host a DHCP reservation.
- **Undocumented territory.** The PV operating mode register (30580) shows values like 10 and 40 that NIBE doesn't document. They look like the SG Ready levels times ten. And none of this is supported by NIBE, so test carefully.

Total hardware cost: €0. The EME 20 stays on the shelf at the installer.
