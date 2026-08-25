import assert from "node:assert/strict";

const baseUrl = process.env.FIYAH_API_URL ?? "http://localhost:4000";
const msisdn = `23767${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return { payload, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

const post = (path, body, cookie) => request(path, { method: "POST", body, cookie });
const send = (text) => post("/sandbox/messages", { msisdn, text });
const getOutbox = async () => (await request(`/sandbox/outbox/${msisdn}`)).payload.items;

async function login(email, password) {
  const result = await post("/admin/auth/login", { email, password });
  assert.ok(result.cookie, "Admin login must set a session cookie");
  return result.cookie;
}

console.log(`Running FIYAH sandbox smoke test as +${msisdn}`);
await send("EN");
let outbox = await getOutbox();
const kycMessage = outbox.find((item) => item.payload.text.includes("/kyc#token="));
assert.ok(kycMessage, "KYC invitation must be sent");
const token = new URLSearchParams(new URL(kycMessage.payload.text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get("token");
assert.ok(token, "KYC link must include a token");

await post("/public/kyc", {
  token,
  legalName: "FIYAH SANDBOX CUSTOMER",
  dateOfBirth: "1990-01-15",
  nationality: "Cameroonian",
  residentialAddress: "123 Sandbox Avenue, Douala, Cameroon",
  idType: "CAMEROON_NATIONAL_ID",
  idNumber: "CM-SANDBOX-1234",
  occupation: "Trader",
  sourceOfFunds: "Business income",
  idDocumentReference: "sandbox-id-document",
  selfieReference: "sandbox-selfie",
  consent: true
});

const adminOne = await login("admin1@fiyah.local", "ChangeMe123!");
const adminTwo = await login("admin2@fiyah.local", "ChangeMe456!");

const kycCases = (await request("/admin/kyc?status=PENDING", { cookie: adminOne })).payload.items;
const kyc = kycCases.find((item) => item.whatsapp_msisdn === msisdn);
assert.ok(kyc, "Submitted KYC must enter the review queue");
await post(`/admin/kyc/${kyc.id}/decision`, { decision: "APPROVED" }, adminOne);

const rate = (await post("/admin/rates", {
  ngnPerXaf: 2.7,
  sourceReference: "Automated sandbox smoke test"
}, adminOne)).payload.item;
await post(`/admin/rates/${rate.id}/approve`, {}, adminTwo);

await send("SEND");
await send("Sandbox Bank Nigeria");
await send("0123456789");
await send("Family");
await send("Family support");

const beneficiaries = (await request("/admin/beneficiaries?status=PENDING", { cookie: adminOne })).payload.items;
const beneficiary = beneficiaries.find((item) => item.whatsapp_msisdn === msisdn);
assert.ok(beneficiary, "Beneficiary must enter manual verification queue");
await post(`/admin/beneficiaries/${beneficiary.id}/verify`, {
  accountName: "SANDBOX BENEFICIARY",
  bankCode: "999"
}, adminOne);

await send("YES");
await send("100000");
outbox = await getOutbox();
assert.ok(outbox.some((item) => item.payload.text.includes("Service fee (1.5%): 1,500 XAF")), "Quote must add the 1.5% fee");
await send("PAY");

let transfers = (await request("/admin/transfers", { cookie: adminOne })).payload.items;
let transfer = transfers.find((item) => item.whatsapp_msisdn === msisdn);
assert.equal(transfer.status, "PAYMENT_PENDING");
assert.equal(Number(transfer.total_charge_xaf), 101_500);

await post(`/sandbox/mtn/${transfer.reference}/status`, { status: "SUCCESSFUL" });
transfers = (await request("/admin/transfers", { cookie: adminOne })).payload.items;
transfer = transfers.find((item) => item.id === transfer.id);
assert.equal(transfer.status, "PAID");
assert.ok(transfer.payout_due_at, "MTN success must start the payout SLA");

await post(`/admin/transfers/${transfer.id}/claim`, {}, adminOne);
await post(`/admin/transfers/${transfer.id}/complete`, { payoutReference: "NGBANK-SMOKE-001" }, adminOne);
transfers = (await request("/admin/transfers", { cookie: adminOne })).payload.items;
transfer = transfers.find((item) => item.id === transfer.id);
assert.equal(transfer.status, "COMPLETED");

outbox = await getOutbox();
assert.ok(outbox.some((item) => item.payload.text.includes("Transfer completed")), "Customer must receive a completion receipt");
console.log(`✓ Completed ${transfer.reference}: 101,500 XAF collected, 270,000 NGN paid`);
