import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET ?? "dev-secret";
const merchantId = process.env.MERCHANT_ID ?? "";
const staffUserId = process.env.STAFF_USER_ID ?? "";
const role = (process.env.STAFF_ROLE ?? "owner") as "owner" | "manager" | "cashier";

if (!merchantId || !staffUserId) {
  console.error("Missing MERCHANT_ID or STAFF_USER_ID");
  process.exit(1);
}

const token = jwt.sign(
  { staff_user_id: staffUserId, merchant_id: merchantId, role },
  secret,
  { expiresIn: "2h" },
);

console.log(token);
