const demoSets = [
  {
    counts: { applications: "12", contacts: "6", followups: "3" },
    rows: [
      ["OL", "Product AI Specialist", "Orbit Labs · Follow-up planned"],
      ["NA", "Backend Platform Engineer", "Northstar AI · Contact saved"],
      ["CN", "Data Automation Analyst", "CloudNest · Timeline updated"]
    ]
  },
  {
    counts: { applications: "18", contacts: "9", followups: "5" },
    rows: [
      ["AP", "Applied ML Engineer", "Apex Systems · Interview stage"],
      ["LV", "Full Stack Developer", "LumaWorks · Reminder set"],
      ["SK", "Automation Engineer", "Skyline Data · Notes added"]
    ]
  },
  {
    counts: { applications: "24", contacts: "11", followups: "7" },
    rows: [
      ["FR", "GenAI Workflow Builder", "FutureRail · Contact found"],
      ["BL", "Python API Engineer", "BlueLayer · Follow-up due"],
      ["QV", "Data Platform Analyst", "QuantaView · Timeline updated"]
    ]
  }
];

let demoIndex = 0;

function updateDemoData() {
  demoIndex = (demoIndex + 1) % demoSets.length;
  const demo = demoSets[demoIndex];

  Object.entries(demo.counts).forEach(([key, value]) => {
    const target = document.querySelector(`[data-demo-count="${key}"]`);
    if (target) target.textContent = value;
  });

  demo.rows.forEach(([avatar, role, meta], index) => {
    const avatarTarget = document.querySelector(`[data-demo-avatar="${index}"]`);
    const roleTarget = document.querySelector(`[data-demo-role="${index}"]`);
    const metaTarget = document.querySelector(`[data-demo-meta="${index}"]`);
    const row = roleTarget?.closest("article");

    row?.classList.remove("is-updating");
    void row?.offsetWidth;
    row?.classList.add("is-updating");

    if (avatarTarget) avatarTarget.textContent = avatar;
    if (roleTarget) roleTarget.textContent = role;
    if (metaTarget) metaTarget.textContent = meta;
  });
}

setInterval(updateDemoData, 3600);
