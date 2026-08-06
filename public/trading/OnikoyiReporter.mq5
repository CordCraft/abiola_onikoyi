//+------------------------------------------------------------------+
//| OnikoyiReporter.mq5                                              |
//| Read-only telemetry reporter for abiolaonikoyi.com               |
//|                                                                  |
//| Attach to ANY single chart in the terminal (one instance per     |
//| terminal is enough; it reports the whole account). It never      |
//| opens, modifies or closes trades. Every InpIntervalSeconds it    |
//| posts balance/equity/margin, open positions and newly closed     |
//| deals to the ingest endpoint, and backfills history on first     |
//| run.                                                             |
//|                                                                  |
//| Setup:                                                           |
//| 1. Tools -> Options -> Expert Advisors ->                        |
//|    "Allow WebRequest for listed URL" -> add:                     |
//|      https://abiolaonikoyi.com                                   |
//| 2. Attach to a chart, set InpSecret to the shared secret and     |
//|    InpLabel to the broker name (e.g. Vantage / BlackBull /       |
//|    Exness). Enable Algo Trading (needed for timers, not trades). |
//+------------------------------------------------------------------+
#property copyright "Abiola Onikoyi"
#property link      "https://abiolaonikoyi.com"
#property version   "1.00"
#property description "Posts read-only account telemetry to the private trading dashboard."

input string InpEndpoint        = "https://abiolaonikoyi.com/api/trading/ingest"; // Ingest endpoint
input string InpSecret          = "";       // Shared secret (TRADING_INGEST_SECRET)
input string InpLabel           = "";       // Friendly broker label, e.g. "Vantage"
input int    InpIntervalSeconds = 30;       // Post interval in seconds
input int    InpBackfillDays    = 730;      // How far back to sync history on first run
input int    InpMaxDealsPerPost = 200;      // History batch size per post

ulong  g_lastTicket   = 0;
string g_stateVarName = "";
int    g_okPosts      = 0;
int    g_failedPosts  = 0;
string g_lastStatus   = "starting";

//+------------------------------------------------------------------+
int OnInit()
  {
   g_stateVarName = "OnikoyiReporter_last_" +
                    IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   if(GlobalVariableCheck(g_stateVarName))
      g_lastTicket = (ulong)GlobalVariableGet(g_stateVarName);
   EventSetTimer(MathMax(5, InpIntervalSeconds));
   UpdateComment();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   Report();
   UpdateComment();
  }

//+------------------------------------------------------------------+
void UpdateComment()
  {
   Comment("Onikoyi Reporter\n",
           "Status: ", g_lastStatus, "\n",
           "Posts ok/failed: ", g_okPosts, "/", g_failedPosts, "\n",
           "History synced up to deal #", (string)g_lastTicket);
  }

//+------------------------------------------------------------------+
//| Minimal JSON string escaping                                      |
//+------------------------------------------------------------------+
string J(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   return(s);
  }

string D2(double v) { return(DoubleToString(v, 2)); }
string D8(double v) { return(DoubleToString(v, 8)); }

//+------------------------------------------------------------------+
string BuildPositionsJson()
  {
   string out = "[";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(i > 0)
         out += ",";
      string type = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
                    ? "sell" : "buy";
      out += "{\"ticket\":" + (string)ticket +
             ",\"symbol\":\"" + J(PositionGetString(POSITION_SYMBOL)) + "\"" +
             ",\"type\":\"" + type + "\"" +
             ",\"volume\":" + D8(PositionGetDouble(POSITION_VOLUME)) +
             ",\"openPrice\":" + D8(PositionGetDouble(POSITION_PRICE_OPEN)) +
             ",\"openTime\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME)) +
             ",\"sl\":" + D8(PositionGetDouble(POSITION_SL)) +
             ",\"tp\":" + D8(PositionGetDouble(POSITION_TP)) +
             ",\"currentPrice\":" + D8(PositionGetDouble(POSITION_PRICE_CURRENT)) +
             ",\"profit\":" + D2(PositionGetDouble(POSITION_PROFIT)) +
             ",\"swap\":" + D2(PositionGetDouble(POSITION_SWAP)) + "}";
     }
   out += "]";
   return(out);
  }

//+------------------------------------------------------------------+
string DealTypeName(long t)
  {
   switch((int)t)
     {
      case DEAL_TYPE_BUY:     return("buy");
      case DEAL_TYPE_SELL:    return("sell");
      case DEAL_TYPE_BALANCE: return("balance");
      case DEAL_TYPE_CREDIT:  return("credit");
      default:                return("other");
     }
  }

string DealEntryName(long e)
  {
   switch((int)e)
     {
      case DEAL_ENTRY_IN:     return("in");
      case DEAL_ENTRY_OUT:    return("out");
      case DEAL_ENTRY_INOUT:  return("inout");
      case DEAL_ENTRY_OUT_BY: return("out_by");
      default:                return("");
     }
  }

//+------------------------------------------------------------------+
//| Deals with ticket > g_lastTicket, oldest first, capped per post   |
//+------------------------------------------------------------------+
string BuildDealsJson(ulong &maxTicketSent)
  {
   maxTicketSent = g_lastTicket;
   datetime from = TimeCurrent() - (datetime)InpBackfillDays * 86400;
   if(!HistorySelect(from, TimeCurrent() + 86400))
      return("[]");

   string out = "[";
   int written = 0;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total && written < InpMaxDealsPerPost; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0 || ticket <= g_lastTicket)
         continue;
      if(written > 0)
         out += ",";
      out += "{\"ticket\":" + (string)ticket +
             ",\"order\":" + (string)HistoryDealGetInteger(ticket, DEAL_ORDER) +
             ",\"position\":" + (string)HistoryDealGetInteger(ticket, DEAL_POSITION_ID) +
             ",\"symbol\":\"" + J(HistoryDealGetString(ticket, DEAL_SYMBOL)) + "\"" +
             ",\"type\":\"" + DealTypeName(HistoryDealGetInteger(ticket, DEAL_TYPE)) + "\"" +
             ",\"entry\":\"" + DealEntryName(HistoryDealGetInteger(ticket, DEAL_ENTRY)) + "\"" +
             ",\"volume\":" + D8(HistoryDealGetDouble(ticket, DEAL_VOLUME)) +
             ",\"price\":" + D8(HistoryDealGetDouble(ticket, DEAL_PRICE)) +
             ",\"sl\":" + D8(HistoryDealGetDouble(ticket, DEAL_SL)) +
             ",\"tp\":" + D8(HistoryDealGetDouble(ticket, DEAL_TP)) +
             ",\"profit\":" + D2(HistoryDealGetDouble(ticket, DEAL_PROFIT)) +
             ",\"swap\":" + D2(HistoryDealGetDouble(ticket, DEAL_SWAP)) +
             ",\"commission\":" + D2(HistoryDealGetDouble(ticket, DEAL_COMMISSION)) +
             ",\"fee\":" + D2(HistoryDealGetDouble(ticket, DEAL_FEE)) +
             ",\"magic\":" + (string)HistoryDealGetInteger(ticket, DEAL_MAGIC) +
             ",\"comment\":\"" + J(HistoryDealGetString(ticket, DEAL_COMMENT)) + "\"" +
             ",\"time\":" + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_TIME)) + "}";
      if(ticket > maxTicketSent)
         maxTicketSent = ticket;
      written++;
     }
   out += "]";
   return(out);
  }

//+------------------------------------------------------------------+
void Report()
  {
   if(InpSecret == "")
     {
      g_lastStatus = "InpSecret is empty, set the shared secret";
      return;
     }

   ulong maxTicketSent = 0;
   string dealsJson = BuildDealsJson(maxTicketSent);

   string json = "{";
   json += "\"account\":{" ;
   json += "\"login\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   json += ",\"server\":\"" + J(AccountInfoString(ACCOUNT_SERVER)) + "\"";
   json += ",\"broker\":\"" + J(AccountInfoString(ACCOUNT_COMPANY)) + "\"";
   json += ",\"label\":\"" + J(InpLabel) + "\"";
   json += ",\"name\":\"" + J(AccountInfoString(ACCOUNT_NAME)) + "\"";
   json += ",\"currency\":\"" + J(AccountInfoString(ACCOUNT_CURRENCY)) + "\"";
   json += ",\"leverage\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE));
   json += "},";
   json += "\"time\":{\"server\":" + IntegerToString((long)TimeTradeServer()) +
           ",\"gmt\":" + IntegerToString((long)TimeGMT()) + "},";
   json += "\"snapshot\":{";
   json += "\"balance\":" + D2(AccountInfoDouble(ACCOUNT_BALANCE));
   json += ",\"equity\":" + D2(AccountInfoDouble(ACCOUNT_EQUITY));
   json += ",\"margin\":" + D2(AccountInfoDouble(ACCOUNT_MARGIN));
   json += ",\"freeMargin\":" + D2(AccountInfoDouble(ACCOUNT_MARGIN_FREE));
   json += ",\"marginLevel\":" + D2(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL));
   json += ",\"profit\":" + D2(AccountInfoDouble(ACCOUNT_PROFIT));
   json += ",\"positions\":" + BuildPositionsJson();
   json += "},";
   json += "\"deals\":" + dealsJson;
   json += "}";

   char data[];
   int len = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0 && data[len - 1] == 0)
      ArrayResize(data, len - 1); // drop the terminating NUL

   string headers = "Content-Type: application/json\r\n" +
                    "X-Trading-Secret: " + InpSecret + "\r\n";
   char result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", InpEndpoint, headers, 15000,
                           data, result, resultHeaders);

   if(status == -1)
     {
      int err = GetLastError();
      g_failedPosts++;
      if(err == 4014)
         g_lastStatus = "URL not allowed: add https://abiolaonikoyi.com under " +
                        "Tools > Options > Expert Advisors > Allow WebRequest";
      else
         g_lastStatus = "WebRequest error " + IntegerToString(err);
      Print("OnikoyiReporter: ", g_lastStatus);
      return;
     }
   if(status != 200)
     {
      g_failedPosts++;
      g_lastStatus = "HTTP " + IntegerToString(status);
      Print("OnikoyiReporter: HTTP ", status, " ",
            CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
      return;
     }

   // Success: the server's stored maximum is the source of truth for the
   // history cursor, in BOTH directions. Ahead of us: another terminal or an
   // earlier install already synced further. Behind us: the database lost
   // rows (or is fresh), so rewind and re-send; deal writes are idempotent.
   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(StringFind(response, "\"sinceTicket\"") >= 0)
     {
      ulong serverTicket = ParseSinceTicket(response);
      if(serverTicket != g_lastTicket)
        {
         g_lastTicket = serverTicket;
         GlobalVariableSet(g_stateVarName, (double)g_lastTicket);
        }
     }
   g_okPosts++;
   g_lastStatus = "ok, last post " + TimeToString(TimeLocal(), TIME_SECONDS);
  }

//+------------------------------------------------------------------+
ulong ParseSinceTicket(string response)
  {
   string key = "\"sinceTicket\":\"";
   int start = StringFind(response, key);
   if(start < 0)
      return(0);
   start += StringLen(key);
   int end = StringFind(response, "\"", start);
   if(end <= start)
      return(0);
   return((ulong)StringToInteger(StringSubstr(response, start, end - start)));
  }
//+------------------------------------------------------------------+
