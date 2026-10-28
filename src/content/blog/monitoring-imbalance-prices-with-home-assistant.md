---
title: "Monitoring imbalance prices with Home Assistant"
date: "2024-06-30"
description: "With the rise of home batteries trading on the imbalance market and solar panel features like Zonneplan’s PowerPlay, there’s growing interest in understanding how imbalance prices fluctuate throughout the day."
categories: ["smarthome"]
---

With the rise of home batteries trading on the imbalance market and solar panel features like Zonneplan’s PowerPlay, there’s growing interest in understanding how imbalance prices fluctuate throughout the day. Fortunately, websites like [Tenergy](https://services.tenergy.nl/public.aspx/actualimbalanceprices) and [Tennet](https://www.tennet.org/english/operational_management/System_data_relating_implementation/system_balance_information/BalansDeltawithPrices.aspx#PanelTabTable) offer real-time insights into balance prices. For those looking to integrate this data into their smart homes, you can load these prices into Home Assistant and create graphs to visualize the historical and current imbalance prices.

## Setting up monitoring

To start, fetch the real-time prices from Tennet. Use the script below, which runs a GET request every 60 seconds to load the latest prices from Tennet.

```yaml
- platform: rest
  name: Tennet Delta Prices
  resource: https://www.tennet.org/xml/balancedeltaprices/balans-delta.xml
  method: GET
  headers:
    User-Agent: Home Assistant
  value_template: >
    {% set ns = namespace(record='') %}
    {% for record in value_json.BALANCE_DELTA.RECORD %}
      {% if loop.first %}
        {% set ns.record = record %}
      {% endif %}
    {% endfor %}
    {{ ns.record | tojson }}
  scan_interval: 60
```

Once you have the prices loaded, extract the relevant information. The prices can be positive or negative, depending on the grid balance. Below is an example script for extracting this data and storing it in a sensor.

```yaml
- platform: template
  sensors:
    tennet_balance_price:
      unit_of_measurement: "EUR"
      friendly_name: "Tennet Balance Price"
      value_template: >
        {% set record = states('sensor.tennet_delta_prices') | from_json %}
        {% if record.MIN_PRICE is defined %}
          {{ record.MIN_PRICE }}
        {% elif record.MAX_PRICE is defined %}
          {{ record.MAX_PRICE }}
        {% else %}
          N/A
        {% endif %}
```

Restart your Home Assistant after setting up these sensors. You should now have a sensor called `sensor.tennet_balance_price` that can be used in a graph component (see below for visualization). Your output should look like this:

![](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)![](/wp-content/uploads/2024/06/Screenshot-2024-06-30-at-19.34.12@2x-1024x427.png)

Sometimes, the grid will have a major surplus or shortage of energy, indicated as “Emergency Power”. This usually results in a significant spike in imbalance prices. To monitor this, create an additional sensor:

```yaml
- platform: template
  sensors:
    tennet_emergency_power:
      friendly_name: "Tennet Emergency Power"
      value_template: >
        {% set record = states('sensor.tennet_delta_prices') | from_json %}
        {{ record.EMERGENCY_POWER if record.EMERGENCY_POWER is defined else 'N/A' }}
```

Now, you’ll have an additional sensor called `sensor.tennet_emergency_power` that can be used in an automation to notify you when emergency power is activated.

## Visualizing imbalance prices

Of course, you’ll want to use the data you’ve imported to visualize the prices and observe how they develop throughout the day. For graphs, I’m using the [Apex Charts Card](https://github.com/RomRider/apexcharts-card), a flexible library with many charting options. If you haven’t installed ApexCharts yet, follow the [installation instructions](https://github.com/RomRider/apexcharts-card?tab=readme-ov-file#installation) first, or leverage the built-in history graph. Here’s an example of how you can visualize the imbalance prices using Apex Charts:

```yaml
type: custom:apexcharts-card
apex_config:
  chart:
    height: 250px
graph_span: 12h
header:
  show: true
  title: Balance prices
  colorize_states: true
  show_states: true
all_series_config:
  stroke_width: 2
series:
  - entity: sensor.tennet_balance_price
```
