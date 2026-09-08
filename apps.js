const STORAGE_KEY = "divinenetSprint1CampaignsV3";

const sampleCampaigns = [
    {
        id: 1,
        campaignName: "Winter Menu Promotion",
        client: "ABC Restaurant",
        brand: "ABC Restaurant",
        objective: "Promote the winter menu",
        targetAudience: "Melbourne customers aged 18-35",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        budget: 5000,
        channel: "Instagram",
        status: "Draft"
    },
    {
        id: 2,
        campaignName: "Spring Awareness Campaign",
        client: "XYZ Clothing",
        brand: "XYZ",
        objective: "Increase brand awareness",
        targetAudience: "Australian customers aged 18-30",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        budget: 7500,
        channel: "Facebook",
        status: "Active"
    }
];

let savedData = localStorage.getItem(STORAGE_KEY);
let campaigns;

if (savedData) {
    try {
        campaigns = JSON.parse(savedData);
    } catch {
        campaigns = [...sampleCampaigns];
    }
} else {
    campaigns = [...sampleCampaigns];
}

if (!Array.isArray(campaigns) || campaigns.length === 0) {
    campaigns = [...sampleCampaigns];
}

saveToStorage();

function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(campaigns));
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
}

function getStatusClass(status) {
    const statusClasses = {
        Active: "status-active",
        Draft: "status-draft",
        Paused: "status-paused",
        Completed: "status-completed"
    };

    return statusClasses[status] || "status-draft";
}

function formatBudget(value) {
    return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function setActiveView(viewName) {
    document.querySelectorAll("[data-view]").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.view === viewName
        );
    });
}

function renderRecentCampaigns() {
    const tableBody =
        document.getElementById("recentCampaignsBody");

    if (!tableBody) {
        return;
    }

    const recentCampaigns = [...campaigns]
        .sort(
            (first, second) =>
                new Date(second.startDate) -
                new Date(first.startDate)
        )
        .slice(0, 5);

    if (recentCampaigns.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5">
                    No campaigns have been created yet.
                </td>
            </tr>
        `;

        return;
    }

    tableBody.innerHTML = recentCampaigns.map((campaign) => `
        <tr>
            <td>
                <strong>
                    ${escapeHtml(campaign.campaignName)}
                </strong>
            </td>

            <td>${escapeHtml(campaign.channel)}</td>

            <td>
                <span class="status-badge ${getStatusClass(campaign.status)}">
                    ${escapeHtml(campaign.status)}
                </span>
            </td>

            <td>${escapeHtml(campaign.startDate)}</td>

            <td>${formatBudget(campaign.budget)}</td>
        </tr>
    `).join("");
}

function hideAll() {
    document.getElementById("dashboardSection").classList.add("hidden");
    document.getElementById("campaignSection").classList.add("hidden");
    document.getElementById("formSection").classList.add("hidden");
    document.getElementById("detailsSection").classList.add("hidden");
}

function updateDashboard() {
    document.getElementById("totalCampaigns").textContent =
        campaigns.length;

    document.getElementById("activeCampaigns").textContent =
        campaigns.filter(
            campaign => campaign.status === "Active"
        ).length;

    document.getElementById("draftCampaigns").textContent =
        campaigns.filter(
            campaign => campaign.status === "Draft"
        ).length;

    renderRecentCampaigns();
}

function showDashboard() {
    hideAll();
    updateDashboard();
    setActiveView("dashboard");

    document
        .getElementById("dashboardSection")
        .classList.remove("hidden");
}

function showCampaigns() {
    hideAll();
    renderCampaigns();
    setActiveView("campaigns");

    document
        .getElementById("campaignSection")
        .classList.remove("hidden");
}

function showCreateForm() {
    hideAll();

    document.querySelector("form").reset();
    document.getElementById("campaignId").value = "";
    document.getElementById("formTitle").textContent =
        "Create Campaign";
    document.getElementById("message").textContent = "";

    setActiveView("create");

    document
        .getElementById("formSection")
        .classList.remove("hidden");
}
function renderCampaigns() {
    const list = document.getElementById("campaignList");
    const filter = document.getElementById("statusFilter").value;

    list.innerHTML = "";

    const results =
        filter === "All"
            ? campaigns
            : campaigns.filter(campaign => campaign.status === filter);

    if (results.length === 0) {
    list.innerHTML = `
        <div class="empty-state">
            <h3>No campaigns found.</h3>
            <p>There are no campaigns matching this view.</p>
        </div>
    `;
    return;
}
    }

    results.forEach(campaign => {
        const card = document.createElement("div");
        card.className = "campaign-card";

        card.innerHTML = `
            <h3>${campaign.campaignName}</h3>
            <p><strong>Client:</strong> ${campaign.client}</p>
            <p><strong>Channel:</strong> ${campaign.channel}</p>
            <p><strong>Status:</strong> ${campaign.status}</p>

           <div class="campaign-actions">
    <button class="action-button" onclick="viewCampaign(${campaign.id})">View</button>
    <button class="action-button" onclick="editCampaign(${campaign.id})">Edit</button>
    <button class="action-button action-danger" onclick="deleteCampaign(${campaign.id})">Delete</button>
</div>
        `;

        list.appendChild(card);
    });
}

function saveCampaign(event) {
    event.preventDefault();

    const campaignName = document
        .getElementById("campaignName")
        .value.trim();

    const client = document
        .getElementById("client")
        .value.trim();

    const brand = document
        .getElementById("brand")
        .value.trim();

    const objective = document
        .getElementById("objective")
        .value.trim();

    const targetAudience = document
        .getElementById("targetAudience")
        .value.trim();

    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const budget = document.getElementById("budget").value;
    const channel = document.getElementById("channel").value;
    const status = document.getElementById("status").value;
    const message = document.getElementById("message");

    if (
        !campaignName ||
        !client ||
        !brand ||
        !objective ||
        !targetAudience ||
        !startDate ||
        !endDate ||
        !budget ||
        !channel
    ) {
        message.textContent = "Please complete all required fields.";
        return;
    }

    if (endDate < startDate) {
        message.textContent =
            "End date cannot be before the start date.";
        return;
    }

    const existingId = document.getElementById("campaignId").value;

    const campaign = {
        id: existingId ? Number(existingId) : Date.now(),
        campaignName,
        client,
        brand,
        objective,
        targetAudience,
        startDate,
        endDate,
        budget: Number(budget),
        channel,
        status
    };

    if (existingId) {
        const index = campaigns.findIndex(
            item => item.id === Number(existingId)
        );

        if (index !== -1) {
            campaigns[index] = campaign;
        }
    } else {
        campaigns.push(campaign);
    }

    saveToStorage();
    updateDashboard();
    showCampaigns();
}

function viewCampaign(id) {
    const campaign = campaigns.find(item => item.id === id);

    if (!campaign) {
        return;
    }

    hideAll();

    document.getElementById("campaignDetails").innerHTML = `
        <h3>${campaign.campaignName}</h3>
        <p><strong>Client:</strong> ${campaign.client}</p>
        <p><strong>Brand:</strong> ${campaign.brand}</p>
        <p><strong>Objective:</strong> ${campaign.objective}</p>
        <p><strong>Target Audience:</strong> ${campaign.targetAudience}</p>
        <p><strong>Start Date:</strong> ${campaign.startDate}</p>
        <p><strong>End Date:</strong> ${campaign.endDate}</p>
        <p><strong>Budget:</strong> $${campaign.budget}</p>
        <p><strong>Channel:</strong> ${campaign.channel}</p>
        <p><strong>Status:</strong> ${campaign.status}</p>
    `;

    document.getElementById("detailsSection").classList.remove("hidden");
}

function editCampaign(id) {
    const campaign = campaigns.find(item => item.id === id);

    if (!campaign) {
        return;
    }

    hideAll();

    document.getElementById("campaignId").value = campaign.id;
    document.getElementById("campaignName").value =
        campaign.campaignName;
    document.getElementById("client").value = campaign.client;
    document.getElementById("brand").value = campaign.brand;
    document.getElementById("objective").value =
        campaign.objective;
    document.getElementById("targetAudience").value =
        campaign.targetAudience;
    document.getElementById("startDate").value =
        campaign.startDate;
    document.getElementById("endDate").value =
        campaign.endDate;
    document.getElementById("budget").value =
        campaign.budget;
    document.getElementById("channel").value =
        campaign.channel;
    document.getElementById("status").value =
        campaign.status;

    document.getElementById("formTitle").textContent =
        "Edit Campaign";
    document.getElementById("message").textContent = "";

    document.getElementById("formSection").classList.remove("hidden");
}

function deleteCampaign(id) {
    const campaign = campaigns.find(item => item.id === id);

    if (!campaign) {
        return;
    }

    const confirmed = confirm(
        `Are you sure you want to delete "${campaign.campaignName}"?`
    );

    if (!confirmed) {
        return;
    }

    campaigns = campaigns.filter(item => item.id !== id);

    saveToStorage();
    updateDashboard();
    renderCampaigns();
}

showDashboard();