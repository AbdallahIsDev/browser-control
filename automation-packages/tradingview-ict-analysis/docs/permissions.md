# Trading Automation Permissions

This automation is written for any Browser Control user, not one specific broker or account.

## Allowed Without Extra Approval

- Read the active TradingView chart through the TradingView MCP.
- Read visible indicators, labels, tables, drawings, boxes, and OHLCV summaries.
- Build an ICT analysis, trade idea, invalidation plan, and journal entry.
- Run paper trading or demo-account actions when the user has clearly selected paper or demo mode.
- Save analysis notes and journal records under the configured Browser Control data home.

## Live Trading Approval Gate

Live MT5, broker, or funded-account orders require explicit per-order approval. Approval must include:

- Account or platform.
- Symbol.
- Side.
- Order type.
- Size or risk.
- Entry.
- Stop loss.
- Targets.

Standing approval text must not bypass this gate. The assistant may prepare the exact order ticket, but it must not submit a live order until the user approves that exact ticket.

## Default Risk Limits

- Maximum risk per live trade: 1 percent of account equity unless the user sets a lower value.
- Maximum simultaneous live trades from this automation: 3.
- Maximum daily drawdown halt: 3 percent.
- Maximum weekly drawdown halt: 5 percent.
- Minimum planned reward:risk: 3:1.
- Avoid new entries inside 30 minutes before or after high-impact news unless the user explicitly approves event-risk mode.

## Stop Commands

- `PAUSE`: stop new analysis runs and do not queue new orders.
- `CLOSE ALL`: prepare close tickets for approval unless the platform is paper/demo.
- `HALT`: stop automation activity.
- `RESUME`: resume normal analysis mode.
- `RISK DOWN`: reduce future risk proposals to 0.5 percent or lower.

## Refusal Rules

The automation must refuse or pause live execution when:

- The user has not approved the exact live order.
- Platform, symbol, size, entry, stop, or targets are ambiguous.
- Risk limits would be breached.
- The TradingView MCP or trade platform state is stale or unreachable.
- The setup lacks a defined stop loss.
- The requested action appears to bypass broker, platform, or safety controls.
