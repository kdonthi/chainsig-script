import { NearContext } from './context';

import { useEffect, useState } from "react";
import Navbar from "./components/Navbar"
import { Wallet } from "./services/near-wallet";
import { EthereumView } from "./components/Ethereum";

// CONSTANTS
const MPC_PROXY_CONTRACT = 'v2.multichain-mpc.testnet';
// const MPC_PROXY_CONTRACT = 'blobfishy.testnet';
const NEAR_ACCOUNT = 'blobfishy.testnet';

// NEAR WALLET
const wallet = new Wallet({ networkId: 'testnet', createAccessKeyFor: MPC_PROXY_CONTRACT });

function App() {
  const [signedAccountId, setSignedAccountId] = useState('');
  const [status, setStatus] = useState("Please login to request a signature");

  useEffect(() => { wallet.startUp(setSignedAccountId) }, []);

  return (
    <NearContext.Provider value={{ wallet, signedAccountId }}>
      <Navbar />
      <div className="container">
        <h4> 🔗 NEAR Multi Chain </h4>
        <p className="small">
          Safely control accounts on other chains through the NEAR MPC service. Learn more in the <a href="https://docs.near.org/abstraction/chain-signatures"> <b>documentation</b></a>.
        </p>

        {signedAccountId &&
          <div style={{ width: '50%', minWidth: '400px' }}>
              <EthereumView props={{ setStatus, MPC_CONTRACT: MPC_PROXY_CONTRACT, NEAR_ACCOUNT: NEAR_ACCOUNT }} />
          </div>
        }

        <div className="mt-3 small text-center">
          {status}
        </div>
      </div>
    </NearContext.Provider>
  )
}

export default App
