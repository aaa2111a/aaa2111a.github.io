/*
 * frhd-abi.js — hand-written minimal ABIs for the EXTERNAL Ethereum contracts the Frog-Heads burn page touches.
 * ===========================================================================
 * gen-front-abi.mjs only emits the 5 Robinhood/TYB contracts from forge artifacts, so these two are NOT in
 * the generated tyb-abi.js and are maintained HERE by hand, verified against source:
 *   - FRHD               = the third-party token (ERC721A, verified on Etherscan) 0x95A57EFF…541710
 *   - FrogHeadBulkBurner = our helper (Code/frhd-burner/src/FrogHeadBulkBurner.sol), 0x404d5B63…6D73
 * ONLY the members the front actually uses are included (least surface):
 *   FRHD:               isApprovedForAll (approval banner) · setApprovalForAll (frogApproveBurner write) ·
 *                       ownerOf (encode/decode the getFrogOwners /rpc ownerOf sweep) ·
 *                       totalSupply (encode/decode the connect-free burn-counter /rpc read)
 *   FrogHeadBulkBurner: burnMany (frogBurnMany write) + its two custom errors (BadBatchSize / NotYourToken)
 *                       so ethers decodes the revert into err.revert.name and the union error-decoder knows them.
 * Merged into window.TYB_ABI so tyb-chain.js's signerContract() / error-union / getFrogOwners see them exactly
 * like the generated ones. Loads AFTER tyb-abi.js (which freezes its object) — we reassign a NEW frozen merge.
 */
(function () {
  'use strict';
  var FRHD_ABI = [
    { type: 'function', name: 'isApprovedForAll', stateMutability: 'view',
      inputs: [{ name: 'owner', type: 'address' }, { name: 'operator', type: 'address' }],
      outputs: [{ name: '', type: 'bool' }] },
    { type: 'function', name: 'setApprovalForAll', stateMutability: 'nonpayable',
      inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }],
      outputs: [] },
    { type: 'function', name: 'ownerOf', stateMutability: 'view',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: '', type: 'address' }] },
    { type: 'function', name: 'totalSupply', stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'uint256' }] }
  ];
  var BURNER_ABI = [
    { type: 'function', name: 'burnMany', stateMutability: 'nonpayable',
      inputs: [{ name: 'ids', type: 'uint256[]' }], outputs: [] },
    { type: 'error', name: 'BadBatchSize', inputs: [] },
    { type: 'error', name: 'NotYourToken', inputs: [{ name: 'tokenId', type: 'uint256' }] }
  ];

  var base = (typeof window !== 'undefined' && window.TYB_ABI) || {};
  var merged = Object.assign({}, base, { FRHD: FRHD_ABI, FrogHeadBulkBurner: BURNER_ABI });
  if (typeof window !== 'undefined') window.TYB_ABI = Object.freeze(merged);
  if (typeof module !== 'undefined' && module.exports) module.exports = { FRHD: FRHD_ABI, FrogHeadBulkBurner: BURNER_ABI };
})();
