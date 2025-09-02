"use client";
import React from "react";
import { Customized as RCustomized } from "recharts";

// Simple pass-through default export so next/dynamic is happy
export default function CustomizedWrapper(props: any) {
  return <RCustomized {...props} />;
}