---
title: "Feeding solar data into a NIBE heat pump with Home Assistant (no EME 20 needed)"
date: "2026-10-28"
description: "NIBE wants a €400 EME 20 module to read your solar inverter. I made Home Assistant pretend to be one instead: first a SunSpec inverter, in the end a Huawei SUN2000 with battery and smart meter."
categories: ["smarthome"]
tags: ["home assistant", "smarthome"]
---

My NIBE S320 indoor unit with an S2125 heat pump can use surplus solar energy to heat hot water. NIBE's way to get that information into the heat pump is the EME 20: a €400 module that sits in the heat pump and talks to your solar inverter over RS485.

That didn't work for me anyway. My solar panels and home battery are from Zonneplan, and their inverters only report to the Zonneplan cloud. Home Assistant already has all of that data, though: PV production from the Zonneplan integration, the grid from my YouLess P1 reader, and the battery from Zonneplan again.

So the question was: can Home Assistant play the part of the solar inverter? It can. This post describes how I got there, including the dead ends.

## What the NIBE can read

Recent S-series firmware has a menu **7.5.12 Modbus TCP/IP accessories**. Turn on **Modbus PV** in 7.5.12.1, and 7.5.12.2 lets you add an inverter with an IP address, port and unit ID. The inverter **type** can be **SunSpec**, **Huawei Sun2000**, **Huawei EMMA** or **Sungrow SH Series**. That choice turns out to matter a lot, as you'll see.

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
| 40255 | 160 (MPPT) | two PV strings plus battery charge/discharge, laid out like a Fronius GEN24 | inverters and battery |
| 40345 | 802 (battery) | SoC and power (the NIBE skips it) | battery |
| 40409 | end marker | `0xFFFF, 0` | fixed |

The add-on config is short. `host_network` makes port 502 reachable on the Home Assistant IP, and `homeassistant_api` gives the add-on a token for the Core API:

```yaml
name: SunSpec emulator
version: "0.3.2"
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
block = ModbusSequentialDataBlock(BASE + 1, initial_registers(opts["battery_max_power"]))
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

The same day it bit me a second time. In the evening the battery was selling about 11 kW to the grid, and the NIBE showed 5.4 kW of export coming from nowhere: sun, house and battery all "no flow". A hybrid inverter's AC output includes the battery, so model 103 has to report PV minus battery power, not PV alone. With that, the heat pump works out the battery flow and the house load itself.

That fixed the house, until the cloud bit back. Later that evening the NIBE showed 10 kW of export and "no flow" for the house again. The cause wasn't the code: Zonneplan's cloud said the battery was discharging 0.7 kW, while the grid meter showed 9.9 kW going out with no sun. Cloud battery values are minutes old or a random sample of a battery that trades in bursts.

So the add-on now only takes the *direction* from the cloud (charging, discharging, idle) and the *amount* from the live grid meter: solar + grid − an estimate of the house (a 750 W base load plus the heat pump's own measured power). I also laid out model 160 the way a Fronius GEN24 does, with two PV strings plus "StCha 3" and "StDisCha 4" for the battery; the NIBE reads those modules and uses them for its sums. It still labels the battery itself "no flow", even with model 124 filled exactly the way a Fronius does it; my guess is that the heat pump only draws battery flow for inverters it officially supports. Every other number on the screen added up.

### The battery only shows up for a Huawei

So I went looking for how it *should* work. NIBE's release notes give it away: "Support for Huawei SUN2000, including Smart Meter and energy dashboard" and "Enhanced compatibility with Huawei Sun2000 PV hybrid inverters". For SunSpec they only ever mention the energy dashboard and the smart meter, never a battery. NIBE's own installation guide for Huawei shows the rest: pick the type **Huawei Sun2000**, and the heat pump reads Huawei's own register map, including the Huawei smart meter through the inverter.

So the add-on got a second mode in which it poses as a Huawei SUN2000 with a LUNA2000 battery and a DTSU666-H smart meter. With logging on, the heat pump read exactly these registers:

| Registers | What | Filled with |
|---|---|---|
| 30000, 30015, 30071 | model, serial number, number of PV strings | a SUN2000-10KTL-M1 with two strings |
| 32000, 32008–32010, 32089 | status and alarms | on-grid, no alarms |
| 32016–32019 | PV1 and PV2 voltage and current | the solar power, split over two strings |
| 32080, 32106 | AC power, lifetime yield | PV minus battery, the PV counter |
| 37101–37118, 37132–37137 | smart meter: voltage, current, power (+ = export), per phase | the YouLess |
| 37758, 37760, 37765 | battery capacity, SoC, charge/discharge power (+ = charging) | the derived battery value |
| 47107–47108 | battery unit 1 and 2 installed | 1 and 0 |

Two details mattered. The heat pump takes solar production from the string voltages and currents, not from Huawei's total input power register. And it only believes there is a battery when 47000 says LUNA2000 and 47107 says "installed"; with those at 0 it counted the battery's 10 kW as sunshine. With both set, the **Energy supply** screen showed the battery at last: 10.3 kW out of the battery, 9.5 kW to the grid, 490 W for the heat pump and 300 W for the house.

## Why the grid comes from the YouLess, not Zonneplan

Zonneplan also reports grid power from its own P1 dongle, and all Zonneplan values update in the same batch. That sounds like the cleanest source, so I tested it against a week of history. At every battery update, I computed house consumption as solar + grid − battery:

| Grid source | House below 0 W (impossible) | House above 5 kW |
|---|---|---|
| Zonneplan P1 | 18.5% | 18.2% |
| YouLess (local, every 10 s) | 8.5% | 8.4% |

The Zonneplan grid value often doesn't drop back to zero. In 43% of the samples it reported import and export at the same time. On top of that, the battery swings between +11 and −11 kW within minutes for energy trading, while its cloud value updates every 5 minutes at best. So even "the same batch" doesn't mean the same moment.

This is also why a home-made "real surplus" calculation didn't work. Letting the NIBE see the live grid meter and decide for itself is the more honest setup.

## The result

The NIBE now shows the full picture on its **Energy supply** screen: solar, grid, house, heat pump and battery, with flows that add up. It thinks it's talking to a Huawei. In menu 4.2.2 I let solar affect **hot water only**, with heat source **compressor only**, and the energy meter set to **smart meter**. Floor heating stays under its own Home Assistant automation.

Floor heating and the air conditioners each have their own controller, and each decision has exactly one owner. The air conditioners are a story of their own: [Teaching my Daikin ACs to cool the room, not the unit](/teaching-my-daikin-acs-to-cool-the-room-not-the-unit/).

I liked that screen enough to build the same diagram for the wall tablet in Home Assistant: a `button-card` with an inline SVG and animated dots in the direction of the flow.

## Build it yourself

Everything below is the exact code that runs in my house. You can copy it into your own Home Assistant and point it at your own sensors.

### What you need

- **Home Assistant OS or Supervised**, because this runs as a local add-on. It listens on port 502 of the Home Assistant host, so give that host a fixed IP (a DHCP reservation is fine).
- **A NIBE S-series heat pump with recent firmware**: the menu **7.5.12 Modbus TCP/IP accessories** must exist. Mine is a VVM S320 with an S2125.
- **Sensors in Home Assistant:**
  - solar power in W, plus one or more lifetime solar energy counters in kWh;
  - grid power in W, **positive for import**, ideally per phase, with phase voltages;
  - grid import and export energy counters in kWh (for a Dutch smart meter: the low and high tariff counters);
  - battery state of charge in % and battery power in W, **positive for charging**. No battery? Point both at a sensor that is always 0.

### 1. Create the add-on

Create a folder `sunspec_emulator` in the local add-ons folder of your Home Assistant host. That's the `addons` share if you use the Samba add-on, or `/addons` over SSH (on recent versions it may be called `/local_apps`). Put these three files in it.

`config.yaml` (replace the entity IDs with your own, the offsets come in step 3):

```yaml
name: SunSpec emulator
version: "0.3.2"
slug: sunspec_emulator
description: >-
  Serves solar production, a grid meter and a home battery from Home Assistant
  to a NIBE S-series heat pump over Modbus TCP, posing as a Huawei SUN2000 with
  LUNA2000 battery and smart meter (protocol: huawei) or as a generic SunSpec
  inverter (protocol: sunspec). No EME 20 needed.
arch:
  - amd64
startup: application
boot: auto
init: false
host_network: true
homeassistant_api: true
options:
  protocol: huawei
  port: 502
  pv_power: sensor.solar_power
  pv_energy:
    - sensor.solar_energy_total
  max_age: 1200
  energy_offset: 0.0
  grid_power: sensor.grid_power
  grid_phase_power:
    - sensor.grid_power_l1
    - sensor.grid_power_l2
    - sensor.grid_power_l3
  grid_phase_voltage:
    - sensor.grid_voltage_l1
    - sensor.grid_voltage_l2
    - sensor.grid_voltage_l3
  grid_import:
    - sensor.grid_import_low
    - sensor.grid_import_high
  grid_export:
    - sensor.grid_export_low
    - sensor.grid_export_high
  grid_max_age: 120
  grid_import_offset: 0.0
  grid_export_offset: 0.0
  battery_soc: sensor.battery_soc
  battery_power: sensor.battery_power
  battery_max_age: 14400
  battery_max_power: 11000
  battery_capacity: 10000
  battery_derive: true
  house_base_load: 750
  heat_pump_power: sensor.heat_pump_power
  heat_pump_power_unit: W
  log_requests: false
schema:
  protocol: list(sunspec|huawei)
  port: port
  pv_power: str
  pv_energy:
    - sensor.solar_energy_total
  max_age: int
  energy_offset: float
  grid_power: str
  grid_phase_power:
    - str
  grid_phase_voltage:
    - str
  grid_import:
    - str
  grid_export:
    - str
  grid_max_age: int
  grid_import_offset: float
  grid_export_offset: float
  battery_soc: str
  battery_power: str
  battery_max_age: int
  battery_max_power: int
  battery_capacity: int
  battery_derive: bool
  house_base_load: int
  heat_pump_power: str
  heat_pump_power_unit: list(W|kW)
  log_requests: bool
```

`Dockerfile`:

```dockerfile
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM $BUILD_FROM

RUN apk add --no-cache python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages "pymodbus~=3.8.0"

COPY sunspec.py /sunspec.py
# Bypass s6: started through s6, the program doesn't get SUPERVISOR_TOKEN.
ENTRYPOINT []
CMD ["python3", "-u", "/sunspec.py"]
```

`sunspec.py`:

```python
"""Huawei SUN2000 or SunSpec inverter, meter and battery (Modbus TCP) backed by
Home Assistant, for a NIBE S-series heat pump (tested on a VVM S320).

The heat pump reads an inverter itself via 'Modbus PV' (menu 7.5.12.2). My
inverters and home battery only report to a cloud, so this add-on poses as
one. Two protocols:

protocol: huawei (inverter type "Huawei Sun2000" on the heat pump)
    Huawei's own register map: SUN2000 inverter, DTSU666-H smart meter and a
    LUNA2000 battery. This is the only type for which the heat pump shows the
    battery flow. It reads PV from the string voltages and currents, decides
    there is a battery from 47000/47107, and takes its power from 37765.

protocol: sunspec (inverter type "SunSpec")
    40000  "SunS"
    40002  model 1   (common: manufacturer, model, serial)
    40070  model 103 (three-phase inverter: AC output = PV minus battery)
    40122  model 203 (three-phase meter: the grid, positive = import)
    40229  model 124 (storage: filled the way a Fronius GEN24 does)
    40255  model 160 (MPPT, like a Fronius GEN24: two PV strings plus
           "StCha 3"/"StDisCha 4" for battery charge and discharge)
    40345  model 802 (battery: SoC and power; the heat pump skips it)
    40409  end marker 0xFFFF, 0
    The heat pump balances house and grid with this, but never draws a
    battery flow for a SunSpec inverter.

Cloud-connected batteries often report minutes late or a random sample (mine
said 0.7 kW while it was sending 10 kW to the grid). With battery_derive on,
the cloud value only gives the direction (charging, discharging, idle) and the
amount comes from the live grid meter: solar + grid - estimated house load
(house_base_load plus the heat pump's own measured power).

Every 10 s it reads the values from Home Assistant. A power value that is older
than max_age seconds (grid: grid_max_age) or unavailable is reported as 0 W or
as "not implemented", so the heat pump never keeps acting on a stale value.
Energy counters never go down and count from an offset in kWh: the NIBE shows
the PV counter as "this month", so set the offsets to the counter values on
the first day of the month you start.
"""

import asyncio
import datetime as dt
import json
import os
import urllib.request

from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.server import StartAsyncTcpServer

BASE = 40000
INV = BASE + 70      # model 103: ID, L, 50 data points
METER = INV + 52     # model 203: ID, L, 105 data points
STOR = METER + 107   # model 124: ID, L, 24 data points
MPPT = STOR + 26     # model 160: ID, L, 8 + 4 x 20 data points (4 modules)
BATT = MPPT + 90     # model 802: ID, L, 62 data points
END = BATT + 64

NI16 = 0x8000        # int16/sunssf "not implemented"
NU16 = 0xFFFF        # uint16/enum "not implemented"
ST_SLEEPING, ST_MPPT = 2, 4
CHA_DISCHARGING, CHA_CHARGING, CHA_FULL, CHA_HOLDING = 3, 4, 5, 6
VOLT = 230


def text(s, n):
    b = s.encode()[: 2 * n].ljust(2 * n, b"\0")
    return [int.from_bytes(b[i : i + 2], "big") for i in range(0, 2 * n, 2)]


def u16(x):
    return int(round(x)) & 0xFFFF


def acc32(x):
    x = int(x) & 0xFFFFFFFF
    return [x >> 16, x & 0xFFFF]


def initial_registers(battery_max_w, battery_wh):
    regs = [0x5375, 0x6E53]  # "SunS"
    regs += [1, 66]
    regs += text("NIBE-HA", 16) + text("Zonneplan PV", 16) + text("", 8)
    regs += text("0.3.2", 8) + text("HA-PV-0001", 16) + [1, NU16]
    regs += [103, 50] + inverter_block(0, 0)
    regs += [203, 105] + meter_block(None, [None] * 3, [None] * 3, 0, 0)
    regs += [124, 24] + storage_block(None, None, battery_max_w)
    regs += [160, 88] + mppt_block(0, 0)
    regs += [802, 62] + battery_block(None, None, battery_max_w, battery_wh)
    regs += [0xFFFF, 0]
    assert len(regs) == END - BASE + 2
    return regs


def inverter_block(watt, wh_100):
    """Model 103. watt = AC output (PV minus battery charging, may be negative),
    wh_100 = lifetime PV energy in units of 100 Wh."""
    amp = abs(watt) / VOLT / 3
    b = [0] * 50
    b[0] = u16(amp * 3 * 100)             # A
    b[1] = b[2] = b[3] = u16(amp * 100)   # AphA/B/C
    b[4] = u16(-2)                        # A_SF
    b[5] = b[6] = b[7] = 400              # PPVphAB/BC/CA
    b[8] = b[9] = b[10] = VOLT            # PhVphA/B/C
    b[12] = u16(watt)                     # W (W_SF 0)
    b[14] = 5000                          # Hz
    b[15] = u16(-2)                       # Hz_SF
    b[16] = u16(watt)                     # VA
    b[20] = 100                           # PF
    b[22:24] = acc32(wh_100)              # WH
    b[24] = 2                             # WH_SF: 100 Wh
    b[25], b[26], b[27], b[28] = NU16, NI16, NU16, NI16  # DCA/DCV
    b[29] = u16(watt)                     # DCW
    b[31] = b[32] = b[33] = b[34] = b[35] = NI16  # temperatures
    b[36] = ST_MPPT if watt != 0 else ST_SLEEPING
    b[37] = NU16                          # StVnd
    return b


def meter_block(watt, phase_w, phase_v, imp_100, exp_100):
    """Model 203. Power positive = import from the grid. Counters in 100 Wh."""
    b = [NI16] * 105
    known = watt is not None
    pw = [p if p is not None else (watt / 3 if known else None) for p in phase_w]
    pv = [v if v is not None else VOLT for v in phase_v]
    amps = [abs(p) / v if p is not None else None for p, v in zip(pw, pv)]
    if known:
        b[0] = u16(sum(a for a in amps if a is not None) * 100)  # A
    for i in range(3):
        if amps[i] is not None:
            b[1 + i] = u16(amps[i] * 100)  # AphA/B/C
    b[4] = u16(-2)                        # A_SF
    b[5] = u16(sum(pv) / 3)               # PhV
    b[6:9] = [u16(v) for v in pv]         # PhVphA/B/C
    b[9] = u16(sum(pv) / 3 * 1.732)       # PPV
    b[10] = b[11] = b[12] = b[9]          # PPVphAB/BC/CA
    b[13] = 0                             # V_SF
    b[14] = 5000                          # Hz
    b[15] = u16(-2)                       # Hz_SF
    if known:
        b[16] = u16(watt)                 # W
    for i in range(3):
        if pw[i] is not None:
            b[17 + i] = u16(pw[i])        # WphA/B/C
    b[20] = 0                             # W_SF
    # 21-35: VA, VAR and PF are not measured (NI16)
    b[36:52] = [0] * 16                   # Wh counters, 0 = not implemented
    b[36:38] = acc32(exp_100)             # TotWhExp
    b[44:46] = acc32(imp_100)             # TotWhImp
    b[52] = 2                             # TotWh_SF: 100 Wh
    b[53:69] = [0] * 16                   # VAh counters
    b[70:102] = [0] * 32                  # VArh counters
    b[103] = b[104] = 0                   # Evt
    return b


def storage_block(soc, watt, battery_max_w):
    """Model 124, filled the way a Fronius GEN24 does: power in W (SF 0),
    percentages in hundredths (SF -2). OutWRte/InWRte are the allowed rates
    (100%), not the actual flow; that lives in model 160. watt positive =
    charging."""
    b = [NU16] * 24
    b[0] = u16(battery_max_w)             # WChaMax (SF 0)
    b[1] = b[2] = 100                     # WChaGra, WDisChaGra (% WChaMax/s)
    b[3] = 0                              # StorCtl_Mod
    b[5] = 0                              # MinRsvPct
    if soc is not None:
        b[6] = u16(soc * 100)             # ChaState (SF -2)
    if soc is not None and watt is not None:
        b[9] = (CHA_CHARGING if watt > 50 else CHA_DISCHARGING if watt < -50
                else CHA_FULL if soc >= 99 else CHA_HOLDING)  # ChaSt
    b[10] = b[11] = 10000                 # OutWRte, InWRte: 100% (SF -2)
    b[15] = 1                             # ChaGriSet: grid charging allowed
    b[16] = 0                             # WChaMax_SF
    b[17] = 0                             # WChaDisChaGra_SF
    b[18] = NI16                          # VAChaMax_SF
    b[19] = u16(-2)                       # MinRsvPct_SF
    b[20] = u16(-2)                       # ChaState_SF
    b[21] = b[22] = NI16                  # StorAval_SF, InBatV_SF
    b[23] = u16(-2)                       # InOutWRte_SF
    return b


def mppt_block(watt, wh_100, battery=None):
    """Model 160 laid out like a Fronius GEN24 hybrid inverter: modules 1-2 are
    the PV strings, module 3 ("StCha 3") is battery charging and module 4
    ("StDisCha 4") battery discharging. The heat pump takes the battery flow
    from these modules. battery positive = charging."""
    cha = max(0, battery or 0)
    dis = max(0, -(battery or 0))
    b = [0] * 8
    b[0] = u16(-2)                        # DCA_SF
    b[1] = 0                              # DCV_SF
    b[2] = 0                              # DCW_SF
    b[3] = 2                              # DCWH_SF: 100 Wh
    b[6] = 4                              # N: number of modules
    b[7] = NU16                           # TmsPer
    for i, (name, w, wh) in enumerate([("PV1", watt, wh_100), ("PV2", 0, 0),
                                       ("StCha 3", cha, 0), ("StDisCha 4", dis, 0)]):
        m = [0] * 20
        m[0] = i + 1                      # ID
        m[1:9] = text(name, 8)            # IDStr
        m[9] = u16(w / 400 * 100)         # DCA
        m[10] = 400                       # DCV
        m[11] = u16(w)                    # DCW
        m[12:14] = acc32(wh)              # DCWH
        m[16] = NI16                      # Tmp
        m[17] = ST_MPPT if w > 0 else ST_SLEEPING  # DCSt
        b += m
    return b


def battery_block(soc, watt, battery_max_w, battery_wh):
    """Model 802. watt positive = charging (as in HA); SunSpec W here is
    positive for discharging, like an inverter's output."""
    b = [NU16] * 62
    b[1] = u16(battery_wh / 10)           # WHRtg (SF 1)
    b[2] = b[3] = u16(battery_max_w / 10)  # WChaRteMax/WDisChaRteMax (SF 1)
    if soc is not None:
        b[9] = u16(soc)                   # SoC (SF 0)
    b[12] = b[13] = NU16                  # NCyc
    if soc is not None and watt is not None:
        b[14] = (CHA_CHARGING if watt > 50 else CHA_DISCHARGING if watt < -50
                 else CHA_FULL if soc >= 99 else CHA_HOLDING)  # ChaSt
    b[15] = 1                             # LocRemCtl: local
    b[16] = b[17] = b[18] = 0             # Hb, CtrlHb, AlmRst
    b[19] = 4                             # Typ: lithium-ion
    b[20] = 3                             # State: connected
    b[22] = b[23] = 0                     # WarrDt
    b[24:32] = [0] * 8                    # Evt1/2, EvtVnd1/2
    b[42] = NI16                          # A
    b[45] = u16(-watt) if watt is not None else NI16  # W
    b[47] = NI16                          # ReqW
    b[48] = 1                             # SetOp: connect
    b[49] = 3                             # SetInvState: started
    b[50] = 0                             # AHRtg_SF
    b[51] = 1                             # WHRtg_SF
    b[52] = 1                             # WChaDisChaMax_SF
    b[53] = NI16                          # DisChaRte_SF
    b[54] = 0                             # SoC_SF
    b[55] = b[56] = NI16                  # DoD_SF, SoH_SF
    b[57] = 0                             # V_SF
    b[58] = b[59] = b[60] = NI16          # CellV_SF, A_SF, AMax_SF
    b[61] = 0                             # W_SF
    return b


def ha_state(entity_id):
    req = urllib.request.Request(
        f"http://supervisor/core/api/states/{entity_id}",
        headers={"Authorization": f"Bearer {os.environ['SUPERVISOR_TOKEN']}"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def fresh(entity_id, max_age):
    """A number from HA, or None if unavailable or older than max_age.

    Age is based on last_reported, which also moves when an integration
    reports the same value again (battery at 100% for hours); last_updated
    does not.
    """
    try:
        s = ha_state(entity_id)
        seen = s.get("last_reported") or s["last_updated"]
        age = (dt.datetime.now(dt.timezone.utc)
               - dt.datetime.fromisoformat(seen)).total_seconds()
        return float(s["state"]) if age <= max_age else None
    except (ValueError, OSError, KeyError):
        return None


def total(entity_ids):
    """Sum of energy counters, or None if one of them is missing."""
    try:
        return sum(float(ha_state(e)["state"]) for e in entity_ids)
    except (ValueError, OSError, KeyError):
        return None


def battery_flow(cloud, pv, grid, house):
    """Battery power (positive = charging) from the live grid meter, with the
    cloud value only deciding the direction. None if there is nothing to go on."""
    if cloud is None:
        return None
    if abs(cloud) < 200:
        return 0.0
    if grid is None:
        return cloud
    derived = pv + grid - house
    return max(0.0, derived) if cloud > 0 else min(0.0, derived)


class LoggingBlock(ModbusSequentialDataBlock):
    """Register block that logs every new read request (address, count) once
    per 10 minutes, so you can see what the heat pump actually asks for."""

    seen = {}

    def getValues(self, address, count=1):
        key = (address - 1, count)
        now = dt.datetime.now()
        if (now - self.seen.get(key, dt.datetime.min)).total_seconds() > 600:
            self.seen[key] = now
            print(f"read {key[0]}..{key[0] + count - 1} ({count})")
        return super().getValues(address, count)


class LoggingContext(ModbusServerContext):
    """Logs every new unit ID a client asks for."""

    units = set()

    def __getitem__(self, slave):
        if slave not in self.units:
            self.units.add(slave)
            print(f"unit ID {slave} requested")
        return super().__getitem__(slave)


class Counter:
    """Energy counter in 100 Wh, counting from an offset in kWh, never down."""

    def __init__(self, offset):
        self.offset, self.value = offset, 0

    def update(self, kwh):
        if kwh is not None:
            self.value = max(self.value, round((kwh - self.offset) * 10))
        return self.value


def i32(x):
    """Two registers, big-endian, signed 32-bit (Huawei I32/U32)."""
    return acc32(int(round(x)))


def huawei_text(s, n):
    return text(s, n)


HW_BASE = 30000      # Huawei SUN2000 register range 30000-47999
HW_SIZE = 18000


def huawei_registers(v, o):
    """Huawei SUN2000 + LUNA2000 + DTSU666-H smart meter, as {address: [regs]}.

    Huawei's own Modbus map (Solar Inverter Modbus Interface Definitions). The
    heat pump reads this when the inverter type is set to SUN2000 in menu
    7.5.12.2, and that type also shows the battery flow. Signs follow Huawei:
    meter power positive = export, battery power positive = charging.
    """
    pv, ac, grid, battery, soc = v["pv"], v["ac"], v["grid"], v["battery"], v["soc"]
    pw = [p if p is not None else (grid / 3 if grid is not None else 0) for p in v["phase_w"]]
    pvv = [x if x is not None else VOLT for x in v["phase_v"]]
    r = {
        30000: huawei_text("SUN2000-10KTL-M1", 15),        # model name
        30015: huawei_text("HA0000000001", 10),            # serial number
        30025: huawei_text("01074871", 10),                # part number
        30070: [428],                                      # model ID
        30071: [2], 30072: [2],                            # PV strings, MPP trackers
        30073: i32(10000), 30075: i32(11000),              # rated / max active power (W)
        32016: [4000, u16(pv / 400 / 2 * 100)],            # PV1 voltage (0.1 V), current (0.01 A)
        32018: [4000, u16(pv / 400 / 2 * 100)],            # PV2
        32064: i32(pv),                                    # input (DC) power, W
        32066: [u16(pvv[0] * 1.732 * 10), u16(pvv[1] * 1.732 * 10), u16(pvv[2] * 1.732 * 10)],
        32069: [u16(pvv[0] * 10), u16(pvv[1] * 10), u16(pvv[2] * 10)],  # phase voltages
        32072: i32(abs(ac) / VOLT / 3 * 1000) * 3,         # phase currents (mA)
        32080: i32(ac),                                    # active (AC) power, W
        32082: i32(0),                                     # reactive power
        32084: [1000],                                     # power factor (0.001)
        32085: [5000],                                     # grid frequency (0.01 Hz)
        32086: [9800],                                     # efficiency (0.01 %)
        32087: [350],                                      # internal temperature (0.1 C)
        32089: [0x0200 if pv > 0 or abs(ac) > 0 else 0x0002],  # on-grid / standby: no irradiation
        32106: i32(v["pv_kwh"] * 100),                     # accumulated yield (0.01 kWh)
        32114: i32(0),                                     # daily yield
        37000: [2 if battery else 1],                      # battery unit 1: running / standby
        37001: i32(battery or 0),                          # unit 1 charge/discharge power, W
        37004: [u16((soc or 0) * 10)],                     # unit 1 SOC (0.1 %)
        37100: [1 if grid is not None else 0],             # meter status: normal
        37101: i32(pvv[0] * 10) + i32(pvv[1] * 10) + i32(pvv[2] * 10),  # phase voltages (0.1 V)
        37107: sum((i32(abs(p) / u * 100) for p, u in zip(pw, pvv)), []),  # currents (0.01 A)
        37113: i32(-(grid or 0)),                          # active power, + = export
        37115: i32(0),                                     # reactive power
        37117: [1000],                                     # power factor
        37118: [5000],                                     # frequency
        37119: i32(v["export_kwh"] * 100),                 # exported energy (0.01 kWh)
        37121: i32(v["import_kwh"] * 100),                 # imported energy (0.01 kWh)
        37125: [1],                                        # meter type: three-phase
        37126: i32(pvv[0] * 17.32) + i32(pvv[1] * 17.32) + i32(pvv[2] * 17.32),  # line voltages
        37132: sum((i32(-p) for p in pw), []),             # phase active power, + = export
        37138: [1],                                        # meter model detection: matched
        37758: i32(o["battery_capacity"]),                 # rated capacity, Wh
        37760: [u16((soc or 0) * 10)],                     # SOC (0.1 %)
        37762: [2 if battery else 1],                      # running status: running / standby
        37763: [4000],                                     # bus voltage (0.1 V)
        37765: i32(battery or 0),                          # charge/discharge power, + = charging
        37780: i32(0), 37782: i32(0),                      # total charge / discharge
        37784: i32(0), 37786: i32(0),                      # today's charge / discharge
        47000: [2],                                        # unit 1 model: HUAWEI-LUNA2000
        47075: i32(o["battery_max_power"]),                # max charging power, W
        47077: i32(o["battery_max_power"]),                # max discharging power, W
        47086: [2],                                        # working mode: max self-consumption
        47089: [0],                                        # unit 2 model: none
        47107: [1], 47108: [0],                            # unit 1 installed, unit 2 not
    }
    return r


def read_values(o, pv_wh, imp_wh, exp_wh):
    """Everything both protocols need, read from Home Assistant."""
    battery_max_w = o["battery_max_power"]
    pv = max(0, min(32767, fresh(o["pv_power"], o["max_age"]) or 0))
    grid = fresh(o["grid_power"], o["grid_max_age"])
    soc = fresh(o["battery_soc"], o["battery_max_age"])
    battery = fresh(o["battery_power"], o["battery_max_age"])
    if o["battery_derive"]:
        hp = fresh(o["heat_pump_power"], o["grid_max_age"]) or 0
        hp *= 1000 if o["heat_pump_power_unit"] == "kW" else 1
        battery = battery_flow(battery, pv, grid, o["house_base_load"] + hp)
    if battery is not None:
        battery = max(-battery_max_w, min(battery_max_w, battery))
    pv_100 = pv_wh.update(total(o["pv_energy"]))
    return {
        "pv": pv, "grid": grid, "soc": soc, "battery": battery,
        "ac": max(-32767, min(32767, pv - (battery or 0))),
        "phase_w": [fresh(e, o["grid_max_age"]) for e in o["grid_phase_power"]],
        "phase_v": [fresh(e, o["grid_max_age"]) for e in o["grid_phase_voltage"]],
        "pv_100": pv_100, "pv_kwh": pv_100 / 10,
        "imp_100": imp_wh.update(total(o["grid_import"])),
        "exp_100": exp_wh.update(total(o["grid_export"])),
        "import_kwh": imp_wh.value / 10, "export_kwh": exp_wh.value / 10,
    }


def write_sunspec(ctx, v, o):
    battery_max_w = o["battery_max_power"]
    ctx[0].setValues(3, INV + 2, inverter_block(v["ac"], v["pv_100"]))
    ctx[0].setValues(3, MPPT + 2, mppt_block(v["pv"], v["pv_100"], v["battery"]))
    ctx[0].setValues(3, METER + 2, meter_block(
        v["grid"], v["phase_w"], v["phase_v"], v["imp_100"], v["exp_100"]))
    ctx[0].setValues(3, STOR + 2, storage_block(v["soc"], v["battery"], battery_max_w))
    ctx[0].setValues(3, BATT + 2, battery_block(
        v["soc"], v["battery"], battery_max_w, o["battery_capacity"]))


def write_huawei(ctx, v, o):
    for addr, regs in huawei_registers(v, o).items():
        ctx[0].setValues(3, addr, regs)


async def updater(ctx, o):
    pv_wh = Counter(o["energy_offset"])
    imp_wh = Counter(o["grid_import_offset"])
    exp_wh = Counter(o["grid_export_offset"])
    write = write_huawei if o["protocol"] == "huawei" else write_sunspec
    last_log = None
    v = {}
    while True:
        try:
            v = read_values(o, pv_wh, imp_wh, exp_wh)
            write(ctx, v, o)
        except Exception as err:  # noqa: BLE001 - never let the loop die
            print(f"Update failed ({err!r})")
        now = dt.datetime.now()
        if now.minute % 5 == 0 and last_log != now.strftime("%H:%M"):
            last_log = now.strftime("%H:%M")
            print(f"{last_log} PV {v.get('pv')} W ({pv_wh.value / 10:.1f} kWh), grid {v.get('grid')} W "
                  f"(import {imp_wh.value / 10:.1f} / export {exp_wh.value / 10:.1f} kWh), "
                  f"battery {v.get('soc')}% {v.get('battery')} W")
        await asyncio.sleep(10)


async def main():
    with open("/data/options.json") as f:
        opts = json.load(f)
    block_cls = LoggingBlock if opts.get("log_requests") else ModbusSequentialDataBlock
    # pymodbus adds 1 to every address (get and set), so a block starts one
    # higher than the first protocol address it serves.
    if opts["protocol"] == "huawei":
        block = block_cls(HW_BASE + 1, [0] * HW_SIZE)
    else:
        block = block_cls(BASE + 1, initial_registers(opts["battery_max_power"], opts["battery_capacity"]))
    slave = ModbusSlaveContext(hr=block, ir=block)
    ctx = (LoggingContext if opts.get("log_requests") else ModbusServerContext)(
        slaves=slave, single=True)
    asyncio.create_task(updater(ctx, opts))
    print(f"{opts['protocol']} on port {opts['port']}: inverter {opts['pv_power']}, "
          f"meter {opts['grid_power']}, battery {opts['battery_soc']}")
    await StartAsyncTcpServer(context=ctx, address=("0.0.0.0", opts["port"]))


if __name__ == "__main__":
    asyncio.run(main())
```

### 2. Install and configure

1. Go to **Settings → Add-ons → Add-on store**, open the ⋮ menu and choose **Check for updates**. "SunSpec emulator" appears under **Local add-ons**.
2. Install it, then open the **Configuration** tab and fill in your entity IDs.
3. Set the three offsets. The NIBE shows the solar counter as "this month", so use the counter values on the first day of the current month (the Home Assistant history or statistics will give you those). Leave them at 0 if you don't care about the monthly number.
4. Set `battery_max_power` to your battery's maximum charge power in W and `battery_capacity` to its capacity in Wh. Keep `protocol: huawei` if you have a battery; `sunspec` works too, but then the heat pump never shows the battery.
5. Start the add-on. The log shows one line every 5 minutes with the values it serves.

### 3. Check it before the heat pump does

From any computer on your network, read a few of the Huawei registers back:

```python
# pip install pymodbus
from pymodbus.client import ModbusTcpClient

c = ModbusTcpClient("192.168.1.10", port=502)
c.connect()

def i32(addr):
    hi, lo = c.read_holding_registers(addr, count=2, slave=1).registers
    x = (hi << 16) | lo
    return x - (1 << 32) if x >= 1 << 31 else x

print("AC power ", i32(32080), "W")
print("grid     ", i32(37113), "W  (+ = export)")
print("battery  ", i32(37765), "W  (+ = charging)")
print("SoC      ", c.read_holding_registers(37760, count=1, slave=1).registers[0] / 10, "%")
c.close()
```

### 4. Set up the NIBE

- **7.5.12.1**: turn on **Modbus PV**.
- **7.5.12.2**: **Add inverter**, type **Huawei Sun2000**, the IP of your Home Assistant host, port **502**, unit ID **1**. Then press **Identify smart meter**; both the inverter and the smart meter should show **Connected**. After a minute **Energy supply** shows sun, grid, house, heat pump and battery.
- **4.2.2 Solar energy**: choose what solar may affect (I only use hot water), set **heat source** to *compressor only*, and set the **energy meter** to *smart meter* so the heat pump looks at real export instead of all production.
- **Don't** turn on the EME 20 accessory (Modbus register 44001). The heat pump will look for the physical module and raise a communication alarm.

### Troubleshooting

- **Set `log_requests: true`** to log every register range and unit ID the heat pump reads. That's how I found out what it wanted, every time.
- **The sun shows the battery's power, and there is no battery icon**: the heat pump doesn't believe there's a battery. 47000 must be 2 (LUNA2000) and 47107 must be 1 (installed); the code above sets both.
- **House shows "no flow" while the battery is busy**: your battery value is late or wrong. Keep `battery_derive: true` and set `house_base_load` to your typical base load and `heat_pump_power` to the heat pump's own power sensor.
- **Values freeze or drop to 0**: the add-on reports 0 W when a sensor is older than `max_age`. Some integrations don't report unchanged values; that's why the battery has its own, longer `battery_max_age`.
- **Using `protocol: sunspec`** (no battery, or another reason): the heat pump treats the device as a hybrid inverter and needs model 160 for PV, and model 103 must report PV minus battery power. The code does both, but it will never draw the battery flow.

## Caveats

- **Battery trading looks like surplus.** When Zonneplan sells battery energy to the grid, the NIBE sees export and may heat water with battery power. I'm watching how often that happens. If needed, the add-on can subtract battery discharge from the export it reports.
- **The NIBE needs a fixed IP.** Give your Home Assistant host a DHCP reservation.
- **Undocumented territory.** The PV operating mode register (30580) shows values like 10 and 40 that NIBE doesn't document. They look like the SG Ready levels times ten. And none of this is supported by NIBE, so test carefully.

Total hardware cost: €0. The EME 20 stays on the shelf at the installer.
