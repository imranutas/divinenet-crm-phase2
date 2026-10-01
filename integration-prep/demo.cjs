'use strict';
const { startSimulator } = require('./simulator.cjs');
const { createPrepClient, exerciseCustomerThenAppointment } = require('./client.cjs');
const { fixtures } = require('./contract.cjs');

async function main() {
  const sim = await startSimulator();
  try {
    const client = createPrepClient(sim.connection);
    const sample = fixtures();
    console.log('SYNTHETIC ONLY: no real customer, lead or appointment; all records disappear when this run closes.');
    console.log(`Local test URL: ${sim.baseUrl} (credentials retained only in process memory)`);
    console.log('Health:', (await client.health()).status);
    console.log('Lead:', (await client.createLead(sample.lead, 'demo_lead_001')).record.id);
    const keys = { customer: 'demo_customer_001', appointment: 'demo_appointment_001' };
    sim.setFaults({ appointmentFailure: true });
    console.log('Injected failure:', JSON.stringify(await exerciseCustomerThenAppointment(client, sample.customer, sample.appointment, keys)));
    sim.setFaults({ appointmentFailure: false });
    console.log('Same-key retry:', JSON.stringify(await exerciseCustomerThenAppointment(client, sample.customer, sample.appointment, keys)));
    console.log('Final fictional record counts:', JSON.stringify(sim.counts()));
  } finally { await sim.close(); }
}
main().catch(() => { console.error('Synthetic demonstration failed; no live success is claimed.'); process.exitCode = 1; });
