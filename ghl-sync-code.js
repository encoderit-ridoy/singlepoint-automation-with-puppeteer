// ============================================================
// HAWKSOFT TO GHL TRANSFORMATION - V4
// Simplified tagging: HS Lead + one lifecycle tag + do-not-market
//   Lifecycle (mutually exclusive, priority order):
//     1. Active-Client    -> any policy Active / Renewal / Inforce
//     2. Prospect-Client  -> no active, has Prospect policy (or no policies / client status Prospect)
//     3. Former-Client    -> no active/prospect, has Cancelled / Nonrenew / Expired policy
// All custom fields unchanged from V3.
// ============================================================

const hawksoftClient = $input.item.json;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function safeGet(obj, path, defaultValue = "") {
  try {
    const keys = path.split(".");
    let result = obj;
    for (const key of keys) {
      result = result?.[key];
      if (result === undefined || result === null) return defaultValue;
    }
    return result || defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatPhone(phone) {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.length === 10 ? `+1${cleaned}` : phone;
}

function cleanEmail(email) {
  if (!email) return "";
  const cleaned = String(email).trim().toLowerCase();
  return cleaned.includes("@") && cleaned.includes(".") ? cleaned : "";
}

function formatDate(date) {
  if (!date) return "";
  try {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
  } catch (error) {
    return "";
  }
}

function cleanString(str) {
  if (!str) return "";
  return String(str).trim();
}

function formatCurrency(amount) {
  if (!amount) return "";
  const num = parseFloat(amount);
  return isNaN(num) ? "" : num.toFixed(2);
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2 - d1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// Treats true, "true", "yes", "y", "1", 1 as enabled
function isFlagOn(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["true", "yes", "y", "1"].includes(value.trim().toLowerCase());
  }
  return false;
}

// ============================================================
// PRODUCER DIRECTORY
// Key = producer code (initials) as it comes from HawkSoft details.producer
// ============================================================

const PRODUCERS = {
  DRA: {
    firstName: "Duke",
    lastName: "Rateau",
    title: "Principal Agent",
    npn: "5422278",
    mobile: "617-201-7102",
  },
  NAS: {
    firstName: "Nayanne",
    lastName: "Silva",
    title: "Insurance Agent",
    npn: "22158701",
    mobile: "978-448-1884",
  },
  JRN: {
    firstName: "Jean Rodney",
    lastName: "Nerestant",
    title: "Insurance Agent",
    npn: "15904995",
    mobile: "",
  },
};

function getProducer(code) {
  const key = cleanString(code).toUpperCase();
  return PRODUCERS[key] || null;
}

// ============================================================
// EXTRACT CLIENT INFO
// ============================================================

const details = safeGet(hawksoftClient, "details", {});
const isCommercial = safeGet(details, "isCommercial", false);
const clientStatus = cleanString(safeGet(details, "status", "Prospect"));

const mailingAddr = safeGet(details, "mailingAddress", {});
const physicalAddr = safeGet(details, "physicalAddress", {});
const address = mailingAddr.address1 ? mailingAddr : physicalAddr;

// ============================================================
// HANDLE MULTIPLE PEOPLE - Get Primary Contact
// ============================================================

const people = safeArray(safeGet(hawksoftClient, "people", []));
const mainContactIds = safeArray(safeGet(details, "mainContacts", []));

let primaryPerson = null;
if (mainContactIds.length > 0) {
  primaryPerson = people.find((p) => p.id === mainContactIds[0]);
}
if (!primaryPerson && people.length > 0) {
  primaryPerson = people[0];
}
primaryPerson = primaryPerson || {};

const firstName = cleanString(safeGet(primaryPerson, "firstName", ""));
const lastName = cleanString(safeGet(primaryPerson, "lastName", ""));
const primaryPersonAge = calculateAge(
  safeGet(primaryPerson, "dateOfBirth", ""),
);

const peopleData = people.map((p) => ({
  dateOfBirth: formatDate(safeGet(p, "dateOfBirth", "")),
  occupation: cleanString(safeGet(p, "occupation", "")),
  gender: cleanString(safeGet(p, "gender", "")),
  relationship: cleanString(safeGet(p, "relationship", "")),
  firstName: cleanString(safeGet(p, "firstName", "")),
  lastName: cleanString(safeGet(p, "lastName", "")),
}));

const allPeopleNames = people
  .map((p) =>
    `${cleanString(safeGet(p, "firstName", ""))} ${cleanString(safeGet(p, "lastName", ""))}`.trim(),
  )
  .filter((name) => name)
  .join(", ");

// ============================================================
// EXTRACT CONTACT INFO (Email, Phone) - From Primary Person
// ============================================================

const contacts = safeArray(safeGet(hawksoftClient, "contacts", []));
const primaryPersonId = safeGet(primaryPerson, "id", "");

const primaryEmail =
  contacts.find(
    (c) =>
      (c.personId === primaryPersonId || c.personId === null) &&
      safeGet(c, "type", "").toLowerCase().includes("email"),
  ) || {};
const primaryPhone =
  contacts.find(
    (c) =>
      (c.personId === primaryPersonId || c.personId === null) &&
      safeGet(c, "type", "").toLowerCase().includes("phone"),
  ) || {};

const email = cleanEmail(safeGet(primaryEmail, "data", ""));
const phone = formatPhone(safeGet(primaryPhone, "data", ""));

// ============================================================
// DO-NOT-MARKET / DNC / DND DETECTION
// Checks client-level flags and every contact entry (email/phone).
// ============================================================

const DNC_KEYS = [
  "doNotMarket",
  "doNotContact",
  "doNotCall",
  "doNotEmail",
  "doNotText",
  "doNotSms",
  "doNotMail",
  "dnc",
  "dnd",
];

const clientDnc = DNC_KEYS.some((k) => isFlagOn(details?.[k]));
const contactDnc = contacts.some((c) => DNC_KEYS.some((k) => isFlagOn(c?.[k])));
const isDoNotMarket = clientDnc || contactDnc;

// ============================================================
// INITIALIZE GHL CONTACT
// ============================================================

const ghlContact = {
  firstName: firstName || "Unknown",
  lastName: lastName || "Contact",
  email: email,
  phone: phone,
  dateOfBirth: formatDate(safeGet(primaryPerson, "dateOfBirth", "")),
  address1: cleanString(safeGet(address, "address1", "")),
  city: cleanString(safeGet(address, "city", "")),
  state: cleanString(safeGet(address, "state", "")),
  postalCode: cleanString(safeGet(address, "zip", "")),
  country: safeGet(address, "countryCode", "US") || "US",
  source: "Hawksoft Integration",
  tags: ["HS Lead"], // default tag, always present
  customFields: {},
};

if (!email) delete ghlContact.email;
if (!phone) delete ghlContact.phone;

if (isDoNotMarket) {
  ghlContact.tags.push("do-not-market");
  ghlContact.dnd = true;
}

// ============================================================
// BASIC CUSTOM FIELDS
// ============================================================

peopleData.forEach((person, index) => {
  const n = index + 1;
  ghlContact.customFields[`person${n}_first_name`] = person.firstName;
  ghlContact.customFields[`person${n}_last_name`] = person.lastName;
  ghlContact.customFields[`person${n}_dob`] = person.dateOfBirth;
  ghlContact.customFields[`person${n}_occupation`] = person.occupation;
  ghlContact.customFields[`person${n}_gender`] = person.gender;
  ghlContact.customFields[`person${n}_relationship`] = person.relationship;
});

ghlContact.customFields.hawksoft_client_id = String(
  safeGet(hawksoftClient, "clientNumber", ""),
);
ghlContact.customFields.hawksoft_client_guid = cleanString(
  safeGet(details, "id", ""),
);
ghlContact.customFields.hawksoft_last_sync = new Date().toISOString();

ghlContact.customFields.dob = formatDate(
  safeGet(primaryPerson, "dateOfBirth", ""),
);
ghlContact.customFields.marital_status = cleanString(
  safeGet(primaryPerson, "maritalStatus", ""),
);
ghlContact.customFields.gender = cleanString(
  safeGet(primaryPerson, "gender", ""),
);
ghlContact.customFields.occupation = cleanString(
  safeGet(primaryPerson, "occupation", ""),
);

if (allPeopleNames) {
  ghlContact.customFields.all_people_on_account = allPeopleNames;
}

if (isCommercial) {
  ghlContact.customFields.company_name = cleanString(
    safeGet(details, "companyName", ""),
  );
  ghlContact.customFields.dba_name = cleanString(
    safeGet(details, "dbaName", ""),
  );
  ghlContact.customFields.business_type = cleanString(
    safeGet(details, "businessType", ""),
  );
}

const producerCode = cleanString(
  safeGet(details, "producer", ""),
).toUpperCase();
const producerInfo = getProducer(producerCode);

ghlContact.customFields.producer = producerCode;
ghlContact.customFields.producer_code = producerCode;
if (producerInfo) {
  ghlContact.customFields.producer_first_name = producerInfo.firstName;
  ghlContact.customFields.producer_last_name = producerInfo.lastName;
  ghlContact.customFields.producer_title = producerInfo.title;
  ghlContact.customFields.producer_npn = producerInfo.npn;
  ghlContact.customFields.producer_mobile = producerInfo.mobile;
}
ghlContact.customFields.csr = cleanString(safeGet(details, "csr", ""));
ghlContact.customFields.office_id = String(safeGet(details, "officeId", ""));

const clientSinceDate = safeGet(details, "clientSince", "");
ghlContact.customFields.client_since = formatDate(clientSinceDate);

if (primaryPersonAge !== null) {
  ghlContact.customFields.age = primaryPersonAge;
}

const today = new Date();
if (clientSinceDate) {
  const daysSinceClient = daysBetween(clientSinceDate, today);
  ghlContact.customFields.client_tenure_days = daysSinceClient;
  ghlContact.customFields.client_tenure_years = Math.floor(
    daysSinceClient / 365,
  );
}

// ============================================================
// PROCESS ALL POLICIES
// ============================================================

const policies = safeArray(safeGet(hawksoftClient, "policies", []));
let totalPremium = 0;
let totalQuotedPremium = 0;

const activePolicies = [];
const prospectPolicies = [];
const cancelledPolicies = [];
const expiredPolicies = [];
const upcomingRenewals = [];

policies.forEach((policy, policyIndex) => {
  try {
    const policyNum = policyIndex + 1;

    const policyType = cleanString(safeGet(policy, "type", ""));
    const policyTitle = cleanString(safeGet(policy, "title", "")).toUpperCase();
    const policyStatus = cleanString(safeGet(policy, "status", ""));
    const policySubStatus = cleanString(safeGet(policy, "subStatus", ""));
    const policyNumber = cleanString(safeGet(policy, "policyNumber", ""));
    const accountNumber = cleanString(safeGet(policy, "accountNumber", ""));
    const carrier = cleanString(safeGet(policy, "carrier", ""));
    const writingCarrier = cleanString(safeGet(policy, "writingCarrier", ""));
    const applicationType = cleanString(safeGet(policy, "applicationType", ""));
    const source = cleanString(safeGet(policy, "source", ""));

    const effectiveDate = safeGet(policy, "effectiveDate", "");
    const expirationDate = safeGet(policy, "expirationDate", "");
    const inceptionDate = safeGet(policy, "inceptionDate", "");
    const soldDate = safeGet(policy, "soldDate", "");
    const statusDate = safeGet(policy, "statusDate", "");

    const premium = parseFloat(safeGet(policy, "premium", 0)) || 0;
    const quotedPremium = parseFloat(safeGet(policy, "quotedPremium", 0)) || 0;

    const term = cleanString(safeGet(policy, "term", ""));
    const numberOfTerms = safeGet(policy, "numberOfTerms", 0);
    const billingType = cleanString(safeGet(policy, "billingType", ""));
    const paymentPlan = cleanString(safeGet(policy, "paymentPlan", ""));
    const agent1 = cleanString(safeGet(policy, "agent1", ""));
    const agent2 = cleanString(safeGet(policy, "agent2", ""));
    const modified_at = cleanString(safeGet(policy, "modified", ""));

    // ---- Status classification ----
    const s = policyStatus.toLowerCase();
    const isActive = s === "active" || s === "renewal" || s === "inforce";
    const isProspect = s === "prospect";
    const isCancelled = s === "cancelled" || s === "nonrenew";
    const isExpired = s === "expired";

    if (isActive) {
      activePolicies.push({ type: policyTitle, premium, expirationDate });
    }
    if (isProspect) prospectPolicies.push({ type: policyTitle });
    if (isCancelled) cancelledPolicies.push({ type: policyTitle });
    if (isExpired) expiredPolicies.push({ type: policyTitle });

    totalPremium += premium;
    totalQuotedPremium += quotedPremium;

    if (isActive && expirationDate) {
      const daysUntilExpiration = daysBetween(today, expirationDate);
      if (daysUntilExpiration >= 0 && daysUntilExpiration <= 90) {
        upcomingRenewals.push({
          type: policyTitle,
          daysUntil: daysUntilExpiration,
          expirationDate,
        });
      }
    }

    // ---- Policy custom fields ----
    const prefix = `policy${policyNum}_`;
    const cf = ghlContact.customFields;

    if (policyType) cf[`${prefix}type`] = policyType;
    if (policyTitle) cf[`${prefix}title`] = policyTitle;
    if (policyStatus) cf[`${prefix}status`] = policyStatus;
    if (policySubStatus) cf[`${prefix}substatus`] = policySubStatus;
    if (policyNumber) cf[`${prefix}number`] = policyNumber;
    if (accountNumber) cf[`${prefix}account_number`] = accountNumber;
    if (carrier) cf[`${prefix}carrier`] = carrier;
    if (writingCarrier) cf[`${prefix}writing_carrier`] = writingCarrier;

    if (effectiveDate)
      cf[`${prefix}effective_date`] = formatDate(effectiveDate);
    if (expirationDate)
      cf[`${prefix}expiration_date`] = formatDate(expirationDate);
    if (inceptionDate)
      cf[`${prefix}inception_date`] = formatDate(inceptionDate);
    if (soldDate) cf[`${prefix}sold_date`] = formatDate(soldDate);
    if (statusDate) cf[`${prefix}status_date`] = formatDate(statusDate);

    if (premium > 0) cf[`${prefix}premium`] = formatCurrency(premium);
    if (quotedPremium > 0)
      cf[`${prefix}quoted_premium`] = formatCurrency(quotedPremium);
    if (billingType) cf[`${prefix}billing_type`] = billingType;
    if (paymentPlan) cf[`${prefix}payment_plan`] = paymentPlan;

    if (applicationType) cf[`${prefix}application_type`] = applicationType;
    if (source) cf[`${prefix}source`] = source;
    if (term) cf[`${prefix}term`] = term;
    if (numberOfTerms) cf[`${prefix}number_of_terms`] = numberOfTerms;
    if (agent1) cf[`${prefix}agent1`] = agent1;
    if (agent2) cf[`${prefix}agent2`] = agent2;
    if (modified_at) cf[`${prefix}modified_at`] = modified_at;

    // ---- Coverages ----
    const coverages = safeArray(safeGet(policy, "coverages", []));
    if (coverages.length > 0) {
      const coverageSummary = coverages
        .map((cov) => {
          const desc = cleanString(safeGet(cov, "description", ""));
          const limits = cleanString(safeGet(cov, "limits", ""));
          const deduct = cleanString(safeGet(cov, "deductibles", ""));
          if (!desc) return "";
          return `${desc}: ${limits}${deduct ? ` (Ded: ${deduct})` : ""}`;
        })
        .filter((c) => c)
        .join(" | ");
      if (coverageSummary) cf[`${prefix}coverages`] = coverageSummary;
    }

    // ---- Vehicles ----
    const autos = safeArray(safeGet(policy, "autos", []));
    if (autos.length > 0) {
      const vehicleList = autos
        .map((auto) => {
          const year = cleanString(safeGet(auto, "year", ""));
          const make = cleanString(safeGet(auto, "make", ""));
          const model = cleanString(safeGet(auto, "model", ""));
          const vin = cleanString(safeGet(auto, "vin", ""));
          if (!year && !make && !model) return "";
          return `${year} ${make} ${model}${vin ? ` (VIN: ${vin})` : ""}`.trim();
        })
        .filter((v) => v)
        .join(" | ");
      if (vehicleList) cf[`${prefix}vehicles`] = vehicleList;
    }

    // ---- Drivers ----
    const drivers = safeArray(safeGet(policy, "drivers", []));
    if (drivers.length > 0) {
      const driverList = drivers
        .map((d) => {
          const first = cleanString(safeGet(d, "firstName", ""));
          const last = cleanString(safeGet(d, "lastName", ""));
          const license = cleanString(safeGet(d, "licenseNumber", ""));
          if (!first && !last) return "";
          return `${first} ${last}${license ? ` (Lic: ${license})` : ""}`.trim();
        })
        .filter((d) => d)
        .join(" | ");
      if (driverList) cf[`${prefix}drivers`] = driverList;
    }

    // ---- Locations ----
    const locations = safeArray(safeGet(policy, "locations", []));
    if (locations.length > 0) {
      const locationList = locations
        .filter((loc) => !safeGet(loc, "isArchived", false))
        .map((loc) => {
          const desc = cleanString(safeGet(loc, "description", ""));
          const locAddr = safeGet(loc, "address", {});
          const addr1 = cleanString(safeGet(locAddr, "address1", ""));
          const city = cleanString(safeGet(locAddr, "city", ""));
          const state = cleanString(safeGet(locAddr, "state", ""));
          if (!desc && !addr1) return "";
          return desc || `${addr1}, ${city}, ${state}`.trim();
        })
        .filter((l) => l)
        .join(" | ");
      if (locationList) cf[`${prefix}locations`] = locationList;
    }

    // ---- Lines of business ----
    const lobs = safeArray(safeGet(policy, "loBs", []));
    if (lobs.length > 0) {
      const lobCodes = lobs
        .map((lob) => cleanString(safeGet(lob, "code", "")))
        .filter((code) => code)
        .join(", ");
      if (lobCodes) cf[`${prefix}lob_codes`] = lobCodes;
    }
  } catch (policyError) {
    console.log(`Error processing policy ${policyIndex}:`, policyError.message);
  }
});

// ============================================================
// SUMMARY FIELDS
// ============================================================

ghlContact.customFields.total_policies = policies.length;
ghlContact.customFields.total_annual_premium = formatCurrency(totalPremium);
ghlContact.customFields.total_quoted_premium =
  formatCurrency(totalQuotedPremium);
ghlContact.customFields.active_policies_count = activePolicies.length;
ghlContact.customFields.prospect_policies_count = prospectPolicies.length;
ghlContact.customFields.cancelled_policies_count = cancelledPolicies.length;

if (upcomingRenewals.length > 0) {
  upcomingRenewals.sort((a, b) => a.daysUntil - b.daysUntil);
  ghlContact.customFields.next_renewal_date = formatDate(
    upcomingRenewals[0].expirationDate,
  );
  ghlContact.customFields.days_until_renewal = upcomingRenewals[0].daysUntil;
}

// ============================================================
// LIFECYCLE TAG (exactly one)
// ============================================================

let lifecycleTag;
if (activePolicies.length > 0) {
  lifecycleTag = "Active-Client";
} else if (
  prospectPolicies.length > 0 ||
  policies.length === 0 ||
  clientStatus.toLowerCase() === "prospect"
) {
  lifecycleTag = "Prospect-Client";
} else if (cancelledPolicies.length > 0 || expiredPolicies.length > 0) {
  lifecycleTag = "Former-Client";
}
if (lifecycleTag) ghlContact.tags.push(lifecycleTag);

// ============================================================
// CLIENTCIRCLE NPS SUPPRESSION (2026)
// Paste into "Transform to GHL Format" right after the LIFECYCLE TAG block,
// before "CONVERT CUSTOM FIELDS TO GHL ARRAY FORMAT".
// Source: ClientCircle_NPS_Sent_2026.xlsx (Match Key column), 343 clients.
// Tag is NOT in Compute Tag Diff patterns, so the sync never removes it.
// ============================================================

const NPS_SENT_TAG = "nps-sent-2026";

// Name lowercased, everything except a-z removed ("Jean-Claude" == "Jeanclaude")
const npsKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const CC_NPS_KEYS = new Set([
  "aamirchougle",
  "abhiilam",
  "adikernevincent",
  "adlereliacin",
  "akeemafolabi",
  "aloizioramos",
  "ameliadossantostovares",
  "amenatabotus",
  "amosdaphnis",
  "andrenajosephblanc",
  "angelobonange",
  "anitabondole",
  "annagarcia",
  "annefednacasseus",
  "annejeanfrancois",
  "antoinemelay",
  "arianesilva",
  "arnauldpetitfrere",
  "arnieeastburn",
  "arturopachescardona",
  "ayodeleadeboye",
  "barbaraready",
  "belindajeancharles",
  "borellestaubain",
  "brentrichter",
  "bruceatherton",
  "brunelplatel",
  "carinegermain",
  "carlineantoine",
  "carlstovall",
  "carmeljoseph",
  "carolynlassiter",
  "cedricpurcell",
  "celiciamcevoy",
  "chidambaramdhanasekaran",
  "christianderavil",
  "christiannaluc",
  "christophermccluskey",
  "cindywaters",
  "claudepierre",
  "clauselmuseau",
  "cledinefede",
  "clemencebernauspolycarp",
  "conandagdeviren",
  "constancevick",
  "coreycarlson",
  "cynthiaeliacin",
  "dadelounenorelus",
  "daehyunkwon",
  "daniellehector",
  "danpogorelc",
  "darrenhuong",
  "darycolin",
  "davidburgos",
  "daviddowd",
  "davidjoseph",
  "deboradeoliveira",
  "dianeisaac",
  "dieudoretprince",
  "dominiqueemmanuel",
  "dominiqueverdieu",
  "donalrateau",
  "dorkadominguezotero",
  "dukendelpe",
  "dukenskernizan",
  "edwinnawynn",
  "edynoel",
  "elaineearley",
  "eliasmiller",
  "eliseedesronvil",
  "emilemagloire",
  "emiliennebernard",
  "enidelouine",
  "erickrys",
  "erikhoubolt",
  "erikvolencic",
  "ervachery",
  "esaiethenor",
  "evanlevine",
  "evelynejosephstiven",
  "evertongayle",
  "fabiennerich",
  "fabienneseide",
  "fahadjajeanbaptiste",
  "faidyjeanbaptiste",
  "fangzhouyu",
  "farhadbayati",
  "fatuelpierre",
  "florencehector",
  "franciajeanbaptiste",
  "frantzopointdujour",
  "fridayonokebhagbe",
  "fritzdubuisson",
  "gabriellerobillard",
  "gaelleesperance",
  "garyvolcy",
  "geraniebalthazar",
  "gerthadabady",
  "gherleenbelizaire",
  "ginaantoineclerfe",
  "ginaguerrier",
  "girmagerato",
  "giwanglee",
  "glendapolanco",
  "gloriaflores",
  "gregoryskomal",
  "guerdajeancharles",
  "guerlinetoussaint",
  "gustavefautin",
  "hubertdugue",
  "irmapierrephilippeetienne",
  "irmgardpierrelys",
  "ivandrocardoso",
  "jacksonbell",
  "jamesbrasco",
  "jamescolimon",
  "janetpaterson",
  "jasminendisch",
  "jasonmurphy",
  "jatinderkaur",
  "javonthurber",
  "jeanblanc",
  "jeanclaudejeancharles",
  "jeandelma",
  "jeandesrosiers",
  "jeandorneus",
  "jeanjeanbaptiste",
  "jeanjeanphilippe",
  "jeanjoseph",
  "jeanlacrete",
  "jeanlucien",
  "jeannerestant",
  "jeanremy",
  "jeanromain",
  "jeansaintcyr",
  "jeansanon",
  "jeansurpris",
  "jeanvertus",
  "jeanwilchyodne",
  "jeffreybistoury",
  "jelerdeleon",
  "jeremiahcollins",
  "jerryjeanpierre",
  "jerrymorisseau",
  "jessiemathew",
  "jetlem",
  "jiakhurana",
  "jingsun",
  "joanelouissaint",
  "jocelainetinoble",
  "joesyverin",
  "johnrannikko",
  "johnsaunders",
  "jokelclerjuste",
  "jonathandelva",
  "jonathanfreiermuth",
  "jonathanhaskell",
  "josecarrasquillo",
  "josephalcindor",
  "josephchery",
  "josephdanier",
  "josephgachette",
  "josephjnpierre",
  "josephnicolas",
  "josephpaul",
  "josephvancol",
  "josianebarbot",
  "josiedivert",
  "joycebriere",
  "judeinnocent",
  "judithgarcia",
  "judithmullin",
  "juliacotter",
  "julienprintemps",
  "julieplunkett",
  "juniorjoseph",
  "juniorlatouche",
  "juwonnicottle",
  "karimshohayeb",
  "katherinebonilla",
  "katialamour",
  "katiuskaurena",
  "katrinachu",
  "kemasdominique",
  "kenersmith",
  "kenolfelisier",
  "kerbychery",
  "kerriebotelho",
  "keslandejeanlouis",
  "ketlyncajuste",
  "kettlyexume",
  "kietchandler",
  "kurthummel",
  "lataraowens",
  "laurentderoncelay",
  "laurepierre",
  "leductoandre",
  "leili",
  "leroybrowne",
  "leutzbuon",
  "lisenebelceus",
  "louischrispin",
  "louisgay",
  "lulittesfaye",
  "luninepierrejerome",
  "mackensondenis",
  "marcmilandmetellus",
  "margarethmengualjean",
  "margellaoliviergalette",
  "mariarodrigues",
  "mariarosa",
  "marieabellardaime",
  "marieaime",
  "mariearmand",
  "mariebastien",
  "mariecharlot",
  "mariedumercy",
  "marieeyma",
  "mariejean",
  "mariejoassaint",
  "mariejosealphonse",
  "mariemicelin",
  "marienormil",
  "mariephilippeoux",
  "mariepiard",
  "mariesaintcyr",
  "mariesaintlouis",
  "mariesylvain",
  "marievictor",
  "mariowitkowski",
  "marjoriefortune",
  "marvinscormier",
  "maryhinson",
  "maximleon",
  "melissajeancharles",
  "meradiedurocher",
  "michaelbrasco",
  "michaelbudda",
  "michaeljulce",
  "michaelsandorse",
  "michaelstankavish",
  "michelekenney",
  "michellemalnati",
  "michelpinault",
  "migensmichel",
  "mimoselaforest",
  "mireillejacques",
  "mireillelesperance",
  "moiseguillaume",
  "molierepierrepaul",
  "moniepierre",
  "mylouleguerre",
  "myrtoflessas",
  "nadeemosman",
  "nadegewhite",
  "nagdatheodore",
  "nahomiemyrthil",
  "nancyaiguier",
  "natachabelony",
  "nataliciomartins",
  "nerettealexis",
  "noreenjoseph",
  "odnamilhomme",
  "olayinkasalaudeen",
  "patriciamarcel",
  "patriciaovilma",
  "patrickjuste",
  "patrickmadhere",
  "paulariley",
  "paulemisca",
  "paulettepen",
  "paulmerise",
  "pedrodestima",
  "petersandorse",
  "petersonchrisostome",
  "phenixcalixte",
  "phitomoleus",
  "pierrealexis",
  "pierrebernadeau",
  "pierredorcellus",
  "pierreemile",
  "pierreeugene",
  "pierreisrael",
  "pierrejacques",
  "pierrepierre",
  "rachellepierrelouis",
  "raymondchicoye",
  "reeshemahmoore",
  "renandneptune",
  "renettejeune",
  "richardsonlaforest",
  "ritaaristide",
  "rodrigovaca",
  "romeljeanbaptiste",
  "ronnymoralesmartinez",
  "roseboyer",
  "rosesabytimagene",
  "rosevolcy",
  "roudybeaulieu",
  "rousierherode",
  "ruthestpierre",
  "sainrilusbeaubrun",
  "samrawitassefa",
  "sandramerisier",
  "sergioyoc",
  "seyhunhepdogan",
  "sharifadeleon",
  "shawnharris",
  "shedlinlaine",
  "skalonnesaintpierre",
  "sofiakernizan",
  "stacymcgrath",
  "sudippaudel",
  "susanparker",
  "susantpokharel",
  "suzetmercury",
  "sylviefrancois",
  "teresalopez",
  "thomaslaventure",
  "thomaslee",
  "tonysantos",
  "uricelouis",
  "valentinacarrenard",
  "valerienestor",
  "valerylarose",
  "vandametellus",
  "venetteracinevincent",
  "wallytsonchounan",
  "walterdormevil",
  "wideliegervais",
  "wilcemascary",
  "williamlundi",
  "wilminajeanjules",
  "wilnersaintilus",
  "xiaojunguo",
  "yolandacruz",
  "yolandeclervois",
  "yolettelouis",
  "yvesbernier",
  "yvesjeancharles",
  "yvespasteur",
  "yvesrosegenty",
  "yvonnehilt",
]);

// Check every person on the HawkSoft account (survey may have gone to a spouse),
// plus company name for commercial accounts.
const npsCandidates = [
  ...people.map(
    (p) => `${safeGet(p, "firstName", "")} ${safeGet(p, "lastName", "")}`,
  ),
  isCommercial ? safeGet(details, "companyName", "") : "",
]
  .map(npsKey)
  .filter(Boolean);

const ccNpsMatch = npsCandidates.some((k) => CC_NPS_KEYS.has(k));
if (ccNpsMatch) ghlContact.tags.push(NPS_SENT_TAG);

// ============================================================
// CONVERT CUSTOM FIELDS TO GHL ARRAY FORMAT
// ============================================================

const customFieldsArray = [];
Object.keys(ghlContact.customFields).forEach((key) => {
  const value = ghlContact.customFields[key];
  if (value !== "" && value !== null && value !== undefined) {
    customFieldsArray.push({ key: key, field_value: String(value) });
  }
});
ghlContact.customFields = customFieldsArray;

ghlContact.tags = [...new Set(ghlContact.tags)];

return {
  json: {
    ghlContact: ghlContact,
    hawksoftClientId: String(safeGet(hawksoftClient, "clientNumber", "")),
    hawksoftClientGuid: cleanString(safeGet(details, "id", "")),
    syncTimestamp: new Date().toISOString(),
    policiesProcessed: policies.length,
    peopleProcessed: people.length,
    hasEmail: !!email,
    hasPhone: !!phone,
    isDoNotMarket: isDoNotMarket,
    lifecycleTag: lifecycleTag || "",
    totalActivePolicies: activePolicies.length,
    totalProspectPolicies: prospectPolicies.length,
    totalPremium: totalPremium,
    upcomingRenewals: upcomingRenewals.length,
  },
};
