# Tavily and Browserless Pricing Research

> Status: current-pricing research report.
> Scope: first-party public pricing and API documentation relevant to this repository's Tavily web-search path and Browserless PDF-rendering path. No application code or credit-allocation recommendations are included.
> Access date: **2026-07-13**.

## Short cost summary

- **Tavily Search:** `basic`, `fast`, and `ultra-fast` Search requests cost **1 API credit** each; `advanced` costs **2 API credits**. Tavily's public pay-as-you-go rate is **$0.008 per API credit**, so the direct pay-as-you-go reference cost is $0.008 or $0.016 per Search request respectively. Tavily's monthly plans list lower effective included-credit prices, from $0.0075 to $0.005 per credit. ([Credits & Pricing](https://docs.tavily.com/documentation/api-credits), [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search))
- **Browserless PDF rendering:** Browserless's public cloud plans meter **browser time**, not PDF pages: **1 unit per 30 seconds of an open browser session**, rounded up. A REST `/pdf` request launches a browser, performs one task, and closes the session, so the unit count depends on session duration; built-in proxy traffic and CAPTCHA solving can add units. ([Unit consumption](https://docs.browserless.io/overview/unit-consumption), [REST APIs](https://docs.browserless.io/rest-apis/intro), [PDF API](https://docs.browserless.io/rest-apis/pdf-api))
- **Browserless overages:** The public pricing page lists overage rates of **$0.0020/unit** for Prototyping, **$0.0017/unit** for Starter, and **$0.0015/unit** for Scale. The displayed prices in the captured page state are annual-billing prices: $25/month, $140/month, and $350/month respectively, with 20k, 180k, and 500k included units. ([Browserless pricing](https://www.browserless.io/pricing))

These figures are provider-cost facts only. They do not define or recommend the application's user-facing credit allowances.

## 1. Tavily API

### 1.1 What one API credit means for Search

Tavily describes API credits as the unit used by its credit-based API pricing model. For the Search endpoint, the request's `search_depth` controls the cost:

| Search mode | API credits per request | Relevant behavior |
| --- | ---: | --- |
| `basic` | 1 | Balanced relevance/latency; one NLP summary per URL |
| `fast` | 1 | Lower-latency search |
| `ultra-fast` | 1 | Lowest-latency search |
| `advanced` | 2 | Higher relevance and multiple semantic snippets per URL |

Source: [Tavily Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search), which lists the four modes and their costs.

The API's `auto_parameters` option can automatically change `search_depth` to `advanced` when Tavily determines that it is likely to improve results; Tavily says that this uses **2 API credits per request**. Explicitly setting `search_depth: basic` avoids that automatic promotion. ([Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search))

The Search API can return per-request usage when `include_usage` is enabled. The example response exposes `usage.credits`, which is the practical value to record when measuring actual provider usage. ([Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search))

### 1.2 Tavily plans and rates

Tavily's current Credits & Pricing documentation lists the following public plans:

| Plan | Included API credits | Published price | Effective included-credit rate |
| --- | ---: | ---: | ---: |
| Researcher | 1,000/month | Free | — |
| Project | 4,000/month | $30/month | $0.0075/credit |
| Bootstrap | 15,000/month | $100/month | $0.0067/credit |
| Startup | 38,000/month | $220/month | $0.0058/credit |
| Growth | 100,000/month | $500/month | $0.005/credit |
| Pay as you go | Per usage | $0.008/credit | $0.008/credit |
| Enterprise | Custom | Custom | Custom |

Sources: [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits) and [Tavily pricing page](https://www.tavily.com/pricing). The detailed plan table is in the documentation; the public pricing page confirms the 1,000-credit free tier and the $0.008 pay-as-you-go rate.

### 1.3 Overage and reset behavior

Tavily documents pay-as-you-go at **$0.008 per credit** and says it allows charging per credit once the selected plan's credit limit is reached. The Search API reference also documents a distinct error when the account's pay-as-you-go limit is exceeded and says that limit can be increased in the Tavily dashboard. The public documentation does not list a separate plan-specific overage rate; the documented over-limit rate is the pay-as-you-go rate, subject to the account's configured PAYGO limit. ([Credits & Pricing](https://docs.tavily.com/documentation/api-credits), [Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search))

Tavily says monthly API credits reset on the **first day of each month**, regardless of the billing date. ([Tavily FAQ](https://docs.tavily.com/faq/faq))

### 1.4 Other Tavily API credit rules

These endpoints are not the repository's current `searchWeb` path, but they are part of Tavily's current API-credit definition:

| Endpoint | Published credit rule |
| --- | --- |
| Extract | Basic: 1 credit per 5 successful URL extractions; Advanced: 2 credits per 5 successful URL extractions. Failed URL extractions are not charged. |
| Map | Regular mapping: 1 credit per 10 successful pages; mapping with `instructions`: 2 credits per 10 successful pages. Failed map requests are not charged. |
| Crawl | Mapping cost plus extraction cost. |
| Research | Dynamic per-request bounds: `model=mini` has a 4-credit minimum and 110-credit maximum; `model=pro` has a 15-credit minimum and 250-credit maximum. |

Source: [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits). These rules should not be applied to a Search request, which is charged by Search depth as described above.

## 2. Browserless.io cloud

### 2.1 What is metered

Browserless defines a **unit** as a block of browser time of up to 30 seconds per browser connection. Longer-running sessions use another unit for each additional 30-second increment, and partial increments are rounded up. A 31-second session therefore uses 2 units; a 45-second session also uses 2 units. Browser time is charged while the session is open, including idle time, across BrowserQL, BaaS (Puppeteer/Playwright), and REST APIs. ([Browserless pricing](https://www.browserless.io/pricing), [Unit consumption](https://docs.browserless.io/overview/unit-consumption))

Additional metered activity:

| Activity | Unit cost | Notes |
| --- | ---: | --- |
| Browser session time | 1 unit / 30 seconds | Rounded up; session duration, not page count, drives this component |
| Built-in residential proxy traffic | 6 units / MB | Added on top of browser time |
| Built-in datacenter proxy traffic | 2 units / MB | Added on top of browser time |
| CAPTCHA solving | 10 units | See the documentation discrepancy below |

Browserless says third-party proxies supplied through `--proxy-server` do not consume Browserless proxy units. It also says session reconnects count as new browser connections and incur a fresh unit charge. ([Unit consumption](https://docs.browserless.io/overview/unit-consumption), [Browserless pricing](https://www.browserless.io/pricing))

**CAPTCHA documentation discrepancy.** The current [Unit consumption documentation](https://docs.browserless.io/overview/unit-consumption) says each CAPTCHA solve **attempt** costs 10 units regardless of success or failure. The current [pricing page](https://www.browserless.io/pricing) summarizes the same amount as 10 units per **successful** solve. Both are first-party sources; the difference is unresolved here. It does not change the base PDF-session formula when no CAPTCHA or built-in proxy is involved.

### 2.2 PDF rendering path

Browserless lists PDF generation as a REST API capability. The `/pdf` endpoint accepts either a URL or raw HTML and returns `application/pdf`; the API documentation says the endpoint uses Puppeteer/Chrome's print engine. ([PDF API](https://docs.browserless.io/rest-apis/pdf-api), [REST APIs](https://docs.browserless.io/rest-apis/intro))

Browserless's REST API overview says each REST request launches a browser, performs one task, and closes the session. Therefore, for the repository's `/pdf` call, the provider-side base unit count is determined by the browser session duration:

```text
base Browserless units = ceil(open browser session seconds / 30)
total units = base units + built-in proxy units + CAPTCHA units (if applicable)
```

The public pricing page does **not** publish a separate flat per-PDF or per-page charge. It presents PDF, screenshot, and download APIs as product capabilities, while the unit definition applies to browser activity. A PDF's page count is therefore not a published billing unit in the sources reviewed. ([Browserless pricing](https://www.browserless.io/pricing), [PDF API](https://docs.browserless.io/rest-apis/pdf-api), [Unit consumption](https://docs.browserless.io/overview/unit-consumption))

### 2.3 Public cloud plans and overage rates

The Browserless pricing page's captured state was **Pay Yearly** and labels the displayed prices “billed annually”; the same page also exposes a Pay Monthly selector. The table below records the rates and allowances actually published in that captured state:

| Plan | Published subscription price | Included units/month | Published overage rate | Maximum session time |
| --- | ---: | ---: | ---: | ---: |
| Free | Free | 1,000 | Not listed on the public page | 1 minute |
| Prototyping | $25/month, billed annually | 20,000 | $0.0020/unit | 15 minutes |
| Starter | $140/month, billed annually | 180,000 | $0.0017/unit | 30 minutes |
| Scale | $350/month, billed annually | 500,000 | $0.0015/unit | 60 minutes |
| Enterprise | Custom | Custom | Custom | Custom |

Sources: [Browserless pricing](https://www.browserless.io/pricing) for plan prices, included units, and overages; [Browserless BaaS best practices](https://docs.browserless.io/baas/best-practices) for the plan session-duration limits. The public page does not expose a Free-plan overage rate in the reviewed state, so no Free-plan overage behavior is inferred here.

For capacity context, the Browserless documentation lists concurrency separately from unit allowance: Free 2, Prototyping 5 monthly / 10 yearly, Starter 30 monthly / 40 yearly, and Scale 80 monthly / 100 yearly. Concurrency limits affect simultaneous sessions, while units meter consumption. ([BaaS best practices](https://docs.browserless.io/baas/best-practices))

## 3. Repository-specific accounting implications (descriptive only)

The repository currently uses Tavily as the research agent's `searchWeb` provider and Browserless's `/pdf` endpoint for document rendering. Based on the provider docs above:

1. A Tavily search count alone is insufficient to estimate cost unless the Search depth is known. A search loop using `advanced` costs twice the API credits of one using `basic`, `fast`, or `ultra-fast`; `auto_parameters` can change that at request time.
2. A Browserless PDF count alone is insufficient to estimate cost. The relevant observation is session duration, rounded to 30-second units, plus any built-in proxy or CAPTCHA usage.
3. Tavily's provider unit is an API credit and Browserless's provider unit is a browser-time unit. They are distinct vendor units with different price schedules; neither source defines an application-level credit denomination.

No user-facing allocation, surcharge, allowance, markup, or tier recommendation is made in this report.

## Sources and access date

All sources below are first-party vendor pages and were accessed on **2026-07-13**:

- [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)
- [Tavily Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Tavily Usage API reference](https://docs.tavily.com/documentation/api-reference/endpoint/usage)
- [Tavily FAQ](https://docs.tavily.com/faq/faq)
- [Tavily pricing page](https://www.tavily.com/pricing)
- [Browserless pricing](https://www.browserless.io/pricing)
- [Browserless Unit consumption](https://docs.browserless.io/overview/unit-consumption)
- [Browserless REST APIs overview](https://docs.browserless.io/rest-apis/intro)
- [Browserless PDF API](https://docs.browserless.io/rest-apis/pdf-api)
- [Browserless BaaS best practices](https://docs.browserless.io/baas/best-practices)
