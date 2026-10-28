---
title: "Uploading your gas meter to MinderGas.nl with Home Assistant"
date: "2021-01-03"
updated: "2022-03-14"
description: "MinderGas.nl is a popular tool to get more insight into your gas usage."
categories: ["smarthome"]
tags: ["home assistant", "smarthome"]
---

[MinderGas.nl](https://www.mindergas.nl/home) is a popular tool to get more insight into your gas usage. If you haven’t used MinderGas.nl yet, this tool allows you to get more insight into how much gas you’re using and lets you compare against peers and your historical gas usage. This is ideal if you’re trying to save gas and making adjustments in your house.

When I started with this tool, I manually entered the values, but why would you do something by hand if you can automate it too. Since I’m using Home Assistant for my home automation (more on this soon!), it should be easy to automate this task using Home Assistant.

I already have my gas meter available as a sensor in Home Assistant (*sensor.gas\_meter*) thanks to my Toon thermostat that I integrated with Home Assistant. MinderGas.nl has an API that allows us to upload our gas meter values easily.

This guide has 3 simple steps we need to follow:

1. Create an API token and store it safely in Home Assistant
2. Add a rest command to your configuration that calls the MinderGas.nl API
3. Add the daily automation that uploads the gas meter values

## Create an API token and store it safely in Home Assistant

First of all, we need to create an API token to use the MinderGas.nl API. If you already have an account, you can go to <https://www.mindergas.nl/member/api> and generate an API token. Now, store this API token safely in your *secrets.yaml* file in Home Assistant. This file should contain:

```
mindergas_api_token: <token>
```

## Add a rest command to your configuration that calls the mindergas.nl API

This step creates the command that will call the API of MinderGas.nl. The command does not contain any information about the date or gas meter values yet. Those will be added later in the daily automation.

Add the code below to your *configuration.yaml* file:

```yaml
rest_command:
  mindergas_upload:
    url: 'https://www.mindergas.nl/api/gas_meter_readings'
    method: POST
    headers:
      content-type: application/json
      AUTH-TOKEN: !secret mindergas_api_token
    payload: '{ "date": "{{date}}", "reading": "{{reading}}" }'
```

## Add the daily automation that uploads the gas meter values

To get the most detailed view of our gas usage, we want to upload our gas meter values every day. MinderGas.nl indicates that they see the values as the end values of that day, so we’ll want to upload the values as late as possible in the day. I’ve chosen to use 23:58 local time, giving the script a little buffer before the next day kicks in.

To avoid making mistakes, I recommend creating this automation using the YAML editor or add it directly to the *automations.yaml* file:

```yaml
- alias: MinderGas Upload
  trigger:
  - platform: time
    at: '23:58'
  action:
    data_template:
      date: '{{ (as_timestamp(now())) | timestamp_custom("%Y-%m-%d", True)}}'
      reading: '{{ states(''sensor.gas_meter'') }}'
    service: rest_command.mindergas_upload
  mode: single
```

Once enabled, the script will run each day at 23:58 and upload your gas meter values to MinderGas.nl. I want to thank [jvdmast](https://gathering.tweakers.net/forum/list_message/65276282#65276282) for his example script, as this gave me great guidance on how to get this working.
