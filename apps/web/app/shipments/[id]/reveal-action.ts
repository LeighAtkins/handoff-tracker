"use server";

import { revealCustomer } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import { getActor } from "@/lib/actor";
import { NotAllowedError } from "@/lib/auth/session";

export type RevealState =
  { customerName: string; destinationPostcode: string } | { error: string } | null;

export async function revealCustomerAction(
  _: RevealState,
  formData: FormData,
): Promise<RevealState> {
  try {
    return await revealCustomer(
      getPrisma(),
      { orderId: String(formData.get("orderId") ?? "") },
      await getActor("VIEWER"),
    );
  } catch (error) {
    if (error instanceof DomainError || error instanceof NotAllowedError)
      return { error: error.message };
    throw error;
  }
}
