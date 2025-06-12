import {
  AccountInfo,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
} from '@solana/web3.js'; 
import { connection } from '../shared/config';

/**
 * LookupTableProvider class
 * 
 * This class solves 2 problems:
 * 1. Cache and geyser subscribe to lookup tables for fast retrieval
 * 2. Compute the ideal lookup tables for a set of addresses
 * 
 * The second problem/solution is needed because jito bundles can not include a txn that uses a lookup table
 * that has been modified in the same bundle. So this class caches all lookups and then computes the ideal lookup tables
 * for a set of addresses used by the arb txn so that the arb txn size is reduced below the maximum.
 */
class LookupTableProvider {
  lookupTables: Map<string, AddressLookupTableAccount>;
  addressesForLookupTable: Map<string, Set<string>>;
  lookupTablesForAddress: Map<string, Set<string>>;
 
  constructor() {
    this.lookupTables = new Map();
    this.lookupTablesForAddress = new Map();
    this.addressesForLookupTable = new Map(); 
  }

  /**
   * Update the lookup table cache with new data
   * @param lutAddress Lookup table address
   * @param lutAccount Lookup table account
   */
  private updateCache(
    lutAddress: PublicKey,
    lutAccount: AddressLookupTableAccount,
  ): void {
    this.lookupTables.set(lutAddress.toBase58(), lutAccount);

    this.addressesForLookupTable.set(lutAddress.toBase58(), new Set());

    for (const address of lutAccount.state.addresses) {
      const addressStr = address.toBase58();
      this.addressesForLookupTable.get(lutAddress.toBase58())?.add(addressStr);
      if (!this.lookupTablesForAddress.has(addressStr)) {
        this.lookupTablesForAddress.set(addressStr, new Set());
      }
      this.lookupTablesForAddress.get(addressStr)?.add(lutAddress.toBase58());
    }
  }

  /**
   * Process a lookup table update
   * @param lutAddress Lookup table address
   * @param data Account data
   */
  private processLookupTableUpdate(
    lutAddress: PublicKey,
    data: AccountInfo<Buffer>,
  ): void {
    // Use an empty lookup table as a fallback
    // This is a temporary workaround for the missing deserializeLookupTable function
    const addresses: PublicKey[] = [];
    for (let i = 24; i < data.data.length; i += 32) {
      if (i + 32 <= data.data.length) {
        const pubkeyBytes = data.data.slice(i, i + 32);
        addresses.push(new PublicKey(pubkeyBytes));
      }
    }

    const state = {
      deactivationSlot: BigInt(0),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses
    };

    const lutAccount = new AddressLookupTableAccount({
      key: lutAddress,
      state
    });

    this.updateCache(lutAddress, lutAccount);
  }

  /**
   * Get a lookup table
   * @param lutAddress Lookup table address
   * @returns Lookup table account
   */
  async getLookupTable(
    lutAddress: PublicKey,
  ): Promise<AddressLookupTableAccount | undefined | null> {
    const lutAddressStr = lutAddress.toBase58();
    if (this.lookupTables.has(lutAddressStr)) {
      return this.lookupTables.get(lutAddressStr);
    }

    const lut = await connection.getAddressLookupTable(lutAddress);
    if (lut.value === null) {
      return null;
    }

    this.updateCache(lutAddress, lut.value);

    return lut.value;
  }

  /**
   * Compute the ideal lookup tables for a set of addresses
   * @param addresses Addresses to look up
   * @returns Ideal lookup tables
   */
  computeIdealLookupTablesForAddresses(
    addresses: PublicKey[],
  ): AddressLookupTableAccount[] {
    const MIN_ADDRESSES_TO_INCLUDE_TABLE = 2;
    const MAX_TABLE_COUNT = 3;

    const addressSet = new Set<string>();
    const tableIntersections = new Map<string, number>();
    const selectedTables: AddressLookupTableAccount[] = [];
    const remainingAddresses = new Set<string>();
    let numAddressesTakenCareOf = 0;

    for (const address of addresses) {
      const addressStr = address.toBase58();

      if (addressSet.has(addressStr)) continue;
      addressSet.add(addressStr);

      const tablesForAddress =
        this.lookupTablesForAddress.get(addressStr) || new Set();

      if (tablesForAddress.size === 0) continue;

      remainingAddresses.add(addressStr);

      for (const table of tablesForAddress) {
        const intersectionCount = tableIntersections.get(table) || 0;
        tableIntersections.set(table, intersectionCount + 1);
      }
    }

    const sortedIntersectionArray = Array.from(
      tableIntersections.entries(),
    ).sort((a, b) => b[1] - a[1]);

    for (const [lutKey, intersectionSize] of sortedIntersectionArray) {
      if (intersectionSize < MIN_ADDRESSES_TO_INCLUDE_TABLE) break;
      if (selectedTables.length >= MAX_TABLE_COUNT) break;
      if (remainingAddresses.size <= 1) break;

      const lutAddresses = this.addressesForLookupTable.get(lutKey);
      if (!lutAddresses) continue;

      const addressMatches = new Set(
        [...remainingAddresses].filter((x) => lutAddresses.has(x)),
      );

      if (addressMatches.size >= MIN_ADDRESSES_TO_INCLUDE_TABLE) {
        const lookupTable = this.lookupTables.get(lutKey);
        if (lookupTable) {
          selectedTables.push(lookupTable);
          for (const address of addressMatches) {
            remainingAddresses.delete(address);
            numAddressesTakenCareOf++;
          }
        }
      }
    }

    return selectedTables;
  }
}

// Create and export a singleton instance
const lookupTableProvider = new LookupTableProvider();

// Initialize with any known lookup tables
lookupTableProvider.getLookupTable(
  new PublicKey('Gr8rXuDwE2Vd2F5tifkPyMaUR67636YgrZEjkJf9RR9V')
).catch(err => console.error('Error initializing lookup table provider:', err));

export { lookupTableProvider };