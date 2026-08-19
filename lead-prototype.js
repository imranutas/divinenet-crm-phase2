javascript
const API_BASE_URL = "http://localhost:3000/api";
const STORAGE_KEY = "divinenetDraftLeads";

const fallbackCampaigns = [
  {
    id: "CAM-001",
    campaignName: "Spring Awareness Demo"
  }
];

const leadForm = document.getElementById("leadForm");
const campaignSelect = document.getElementById("campaignId");
const connectionStatus = document.getElementById("connectionStatus");
const leadMessage = document.getElementById("leadMessage");
const leadList = document.getElementById("leadList");

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(value).replace(
    /[&<>"']/g,
    (character) => replacements[character]
  );
}

function setConnectionStatus(message, statusClass) {
  connectionStatus.textContent = message;
  connectionStatus.className = `status ${statusClass}`;
}

function populateCampaigns(campaigns) {
  campaignSelect.innerHTML =
    '<option value="">Select campaign</option>';

  campaigns.forEach((campaign) => {
    const option = document.createElement("option");

    option.value = campaign.id;
    option.textContent =
      `${campaign.id} - ${campaign.campaignName}`;

    campaignSelect.appendChild(option);
  });
}

async function loadCampaigns() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/campaigns`
    );

    if (!response.ok) {
      throw new Error("Campaign API returned an error");
    }

    const result = await response.json();

    if (
      !result.success ||
      !Array.isArray(result.data) ||
      result.data.length === 0
    ) {
      throw new Error("Campaign data was unavailable");
    }

    populateCampaigns(result.data);

    setConnectionStatus(
      "Connected to the campaign backend API.",
      "status-success"
    );
  } catch (error) {
    populateCampaigns(fallbackCampaigns);

    setConnectionStatus(
      "Mock mode: the backend is unavailable, so a fictional fallback campaign is being used.",
      "status-warning"
    );
  }
}

function getStoredLeads() {
  const storedValue = localStorage.getItem(STORAGE_KEY);

  if (!storedValue) {
    return [];
  }

  try {
    return JSON.parse(storedValue);
  } catch (error) {
    return [];
  }
}

function saveStoredLeads(leads) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(leads)
  );
}

function renderLeads() {
  const leads = getStoredLeads();

  if (leads.length === 0) {
    leadList.innerHTML =
      '<p class="empty-message">No draft leads have been saved.</p>';

    return;
  }

  leadList.innerHTML = leads.map((lead) => `
    <article class="lead-card">
      <h3>
        ${escapeHtml(lead.id)} -
        ${escapeHtml(lead.firstName)}
        ${escapeHtml(lead.lastName)}
      </h3>

      <p>
        <strong>Campaign:</strong>
        ${escapeHtml(lead.campaignName)}
      </p>

      <p>
        <strong>Email:</strong>
        ${escapeHtml(lead.email)}
      </p>

      <p>
        <strong>Source:</strong>
        ${escapeHtml(lead.sourcePlatform)}
      </p>

      <p>
        <strong>Consent:</strong>
        ${escapeHtml(lead.consentStatus)}
      </p>

      <p>
        <strong>Status:</strong>
        ${escapeHtml(lead.leadStatus)}
      </p>

      <p>
        <strong>Data status:</strong>
        Fictional draft
      </p>

      <button
        type="button"
        class="delete-button"
        onclick="deleteDraftLead('${escapeHtml(lead.id)}')"
      >
        Delete Draft
      </button>
    </article>
  `).join("");
}

function deleteDraftLead(leadId) {
  const leads = getStoredLeads();

  const remainingLeads = leads.filter(
    (lead) => lead.id !== leadId
  );

  saveStoredLeads(remainingLeads);
  renderLeads();

  leadMessage.textContent =
    "Draft lead removed from this browser.";
}

leadForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!leadForm.checkValidity()) {
    leadForm.reportValidity();

    leadMessage.textContent =
      "Complete all required fields before saving.";

    return;
  }

  const selectedCampaignText =
    campaignSelect.options[
      campaignSelect.selectedIndex
    ].textContent;

  const lead = {
    id: `LEAD-${Date.now()}`,
    campaignId: campaignSelect.value,
    campaignName: selectedCampaignText,
    firstName:
      document.getElementById("firstName").value.trim(),
    lastName:
      document.getElementById("lastName").value.trim(),
    email:
      document.getElementById("email").value.trim(),
    phone:
      document.getElementById("phone").value.trim(),
    sourcePlatform:
      document.getElementById("sourcePlatform").value,
    consentStatus:
      document.getElementById("consentStatus").value,
    leadStatus:
      document.getElementById("leadStatus").value,
    dataStatus: "Mock",
    createdAt: new Date().toISOString()
  };

  const leads = getStoredLeads();

  leads.unshift(lead);
  saveStoredLeads(leads);

  renderLeads();
  leadForm.reset();

  leadMessage.textContent =
    "Fictional draft lead saved in this browser.";
});

leadForm.addEventListener("reset", () => {
  leadMessage.textContent = "";
});

window.deleteDraftLead = deleteDraftLead;

loadCampaigns();
renderLeads();
