import dotenv from 'dotenv';
dotenv.config();
import { OpenCatzHub } from '../dist/orchestrator/hub.js';
import { KrystalCloudAdapter } from '../dist/adapters/krystal-cloud-adapter.js';

async function test() {
  console.log('Testing KrystalCloudAdapter...');
  const adapter = new KrystalCloudAdapter();
  console.log('Adapter configured:', adapter.isConfigured());
  
  const rawPools = await adapter.fetchTopRobinhoodPools(10000, 100000);
  console.log('Raw pools fetched from Krystal:', rawPools.length);
  if (rawPools.length > 0) {
    console.log('Top 5 raw pools:');
    rawPools.slice(0, 5).forEach(p => {
      console.log(' - ' + p.pairName + ': TVL=$' + p.tvlUsd + ', 24hVol=$' + p.volume24hUsd + ', 1hFee=$' + p.fee1hUsd + ', 24hFee/TVL=' + (p.feesToTvlRatio24h*100).toFixed(2) + '%, 1hVol/ActiveTVL=' + p.volumeToActiveTvlRatio1h.toFixed(2));
    });
  }

  const highYield = adapter.filterHighYieldPools(rawPools, { minTvlUsd: 10000, minFeeTvlRatio24h: 0.02 });
  console.log('High yield filtered pools count:', highYield.length);
  if (highYield.length > 0) {
    console.log('Passed highYield pools:');
    highYield.forEach(p => {
      console.log(' - ' + p.pairName + ': TVL=$' + p.tvlUsd + ', 24hVol=$' + p.volume24hUsd + ', 1hFee=$' + p.fee1hUsd + ', fee/TVL=' + (p.feesToTvlRatio24h*100).toFixed(2) + '%');
    });
  }

  console.log('\nTesting full hub.runLPPass()...');
  const hub = new OpenCatzHub();
  const reports = await hub.runLPPass('lp-robinhood');
  console.log('hub.runLPPass reports count:', reports.length);
  reports.forEach(r => {
    console.log(' - Signal: ' + r.payload?.title + ', Confidence: ' + r.confidence + ', Passed: ' + r.passed);
  });
}

test().catch(console.error);
