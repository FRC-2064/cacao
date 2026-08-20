import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { actorArgs } from "./validators";

export const listUsers = query({
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const listAccessRequests = query({
  handler: async (ctx) => {
    return await ctx.db.query("accessRequests").collect();
  },
});

export const submitAccessRequest = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    gradYear: v.number(),
    subteam: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accessRequests")
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        firstName: args.firstName,
        lastName: args.lastName,
        gradYear: args.gradYear,
        subteam: args.subteam,
        notes: args.notes,
        status: "pending",
        submittedAt: now,
      });
      return existing._id;
    }

    const reqId = await ctx.db.insert("accessRequests", {
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      gradYear: args.gradYear,
      subteam: args.subteam,
      notes: args.notes,
      status: "pending",
      submittedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: `${args.firstName} ${args.lastName}`,
      actorEmail: args.email,
      actorRole: "student",
      action: "create",
      entityType: "user",
      entityId: reqId,
      entityName: `${args.firstName} ${args.lastName}`,
      summary: `Submitted access request for ${args.email} (Class of ${args.gradYear}, ${args.subteam})`,
    });

    return reqId;
  },
});

export const approveAccessRequest = mutation({
  args: {
    requestId: v.id("accessRequests"),
    role: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer")),
    mentorName: v.string(),
    mentorEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");

    const now = Date.now();
    await ctx.db.patch(args.requestId, {
      status: "approved",
      reviewedAt: now,
      reviewedBy: args.mentorName,
    });

    const fullName = `${req.firstName} ${req.lastName}`;

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", req.email))
      .first();

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        role: args.role,
        status: "active",
        approvedBy: args.mentorName,
        approvedAt: now,
      });
    } else {
      await ctx.db.insert("users", {
        name: fullName,
        email: req.email,
        role: args.role,
        gradYear: req.gradYear,
        subteam: req.subteam,
        status: "active",
        approvedBy: args.mentorName,
        approvedAt: now,
        createdAt: now,
        lastActiveAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.mentorName,
      actorEmail: args.mentorEmail,
      actorRole: "admin",
      action: "approve_user",
      entityType: "user",
      entityId: args.requestId,
      entityName: fullName,
      summary: `Approved student access for ${fullName} (${req.email}) with role "${args.role}"`,
    });
  },
});

export const graduateClassBatch = mutation({
  args: {
    gradYear: v.number(),
    mentorName: v.string(),
    mentorEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const students = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("gradYear"), args.gradYear))
      .collect();

    const now = Date.now();
    for (const student of students) {
      await ctx.db.patch(student._id, {
        role: "graduated",
        status: "graduated",
      });
    }

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.mentorName,
      actorEmail: args.mentorEmail,
      actorRole: "admin",
      action: "graduate_batch",
      entityType: "user",
      entityId: `class_${args.gradYear}`,
      entityName: `Class of ${args.gradYear}`,
      summary: `Graduated and archived ${students.length} student account(s) for the Class of ${args.gradYear}`,
    });

    return students.length;
  },
});

export const rejectAccessRequest = mutation({
  args: { requestId: v.id("accessRequests"), ...actorArgs },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");

    await ctx.db.patch(args.requestId, {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: args.actorName,
    });

    await logAudit(ctx, args, {
      action: "reject_user",
      entityType: "user",
      entityId: args.requestId,
      entityName: `${req.firstName} ${req.lastName}`,
      summary: `Denied access request for ${req.email}`,
    });
  },
});
