/* ============================================================
   Pyjama Dz Tag Scanner — configuration
   ------------------------------------------------------------
   Leave both values empty and the scanner runs entirely on this
   device (browser storage). Fill them in and every phone that
   opens the page shares one live database.

   Get them from your Supabase dashboard:
     Project Settings -> Data API -> Project URL
     Project Settings -> API Keys  -> anon / public key

   Run schema.sql in the Supabase SQL editor FIRST, or the tables
   will not exist.

   NOTE ON THE KEY: the anon key ships to the browser and is
   readable by anyone who opens the page. With the permissive
   policies in schema.sql, anyone who has both the page URL and
   that key can read and write your products and scans. That is
   fine for a page you keep to your own phones. If it ever goes
   somewhere public, switch to Supabase Auth and tighten the
   policies — see the README.
   ============================================================ */

window.PYJAMADZ_CONFIG = {
  supabaseUrl: "",       // e.g. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",   // e.g. "eyJhbGciOiJIUzI1NiIsInR5cCI6..."

  // How many recent scans to keep on screen.
  scanWindow: 500
};
