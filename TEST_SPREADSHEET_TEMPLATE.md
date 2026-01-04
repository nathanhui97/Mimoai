# Test Spreadsheet Template

## Quick Setup Instructions

### Option 1: Google Sheets (Recommended)

1. Go to: https://sheets.google.com
2. Click "Blank" to create a new spreadsheet
3. Name it: "Autoflow Test Spreadsheet"
4. Copy the template structure below

### Option 2: Excel Online

1. Go to: https://office.live.com/start/Excel.aspx
2. Click "New blank workbook"
3. Name it: "Autoflow Test Workbook"
4. Copy the template structure below

---

## 📋 Template Structure

### Sheet 1: Basic Testing

Copy this structure to your spreadsheet:

```
Row 1 (Headers):
A1: Name
B1: Email
C1: Phone
D1: Status
E1: Notes

Rows 2-10: Leave empty for testing
```

**Purpose**: Test basic input operations, header-based selection, and next empty cell detection.

---

### Sheet 2: Data Entry Testing

```
Row 1 (Headers):
A1: Product Name
B1: SKU
C1: Category
D1: Price
E1: Quantity
F1: Supplier

Row 2 (Sample Data):
A2: Widget
B2: WID-001
C2: Hardware
D2: 19.99
E2: 50
F2: Acme Corp

Rows 3-20: Leave empty
```

**Purpose**: Test complex data entry workflows and batch operations.

---

### Sheet 3: Contact List

```
Row 1 (Headers):
A1: First Name
B1: Last Name
C1: Email Address
D1: Phone Number
E1: Company
F1: Role
G1: Last Contact

Rows 2-15: Leave empty
```

**Purpose**: Test realistic contact management scenarios.

---

### Sheet 4: Inventory

```
Row 1 (Headers):
A1: Item ID
B1: Description
C1: Location
D1: Stock Level
E1: Reorder Point
F1: Last Updated

Row 2-3 (Sample Data):
A2: 1001        A3: 1002
B2: Keyboard    B3: Mouse
C2: Warehouse A C2: Warehouse B
D2: 45          D3: 120
E2: 20          E3: 30
F2: 2024-01-01  F3: 2024-01-02

Rows 4-25: Leave empty
```

**Purpose**: Test finding next empty rows and updating existing data.

---

### Sheet 5: Special Characters Test

```
Row 1 (Headers):
A1: Text Input
B1: Symbols
C1: Numbers
D1: Mixed

Row 2-10: Leave empty for testing special characters
```

**Purpose**: Test handling of special characters, unicode, emojis, etc.

---

### Sheet 6: Large Dataset

```
Row 1 (Headers):
A1: ID
B1: Name
C1: Value 1
D1: Value 2
E1: Value 3
F1: Value 4
G1: Value 5

Rows 2-100: Leave empty
```

**Purpose**: Test performance with larger datasets and batch operations.

---

## 🧪 Pre-loaded Test Data (Optional)

If you want to test updates/modifications, add this sample data:

### Sheet 1 Sample Data:
```
Row 2: John Doe | john@test.com | 555-1111 | Active | Test user
Row 3: Jane Smith | jane@test.com | 555-2222 | Pending | New contact
Row 4: Bob Wilson | bob@test.com | 555-3333 | Inactive | Old contact
```

---

## 📝 Testing Checklist

Use this spreadsheet to perform these tests:

### ✅ Test 1: Direct Cell Reference
- [ ] Type "Test Value" in cell A5
- [ ] Type "Another Value" in cell B10
- [ ] Type "Far Cell" in cell Z50

### ✅ Test 2: Header-Based Input
- [ ] In the "Name" column, row 5, type "Alice Brown"
- [ ] In the "Email" column, row 5, type "alice@test.com"
- [ ] In the "Status" column, row 5, type "Active"

### ✅ Test 3: Next Empty Cell
- [ ] Add "Charlie Davis" to the next empty row in the Name column
- [ ] Add "charlie@test.com" to the next empty row in the Email column

### ✅ Test 4: Batch Entry
- [ ] Fill row 6 with complete contact information for multiple fields at once

### ✅ Test 5: Read Operations
- [ ] Read the value in cell A2
- [ ] Read the value in cell B3
- [ ] Verify the agent reports correct values

### ✅ Test 6: Special Characters
- [ ] Type: !@#$%^&*()
- [ ] Type: "Quoted text"
- [ ] Type: Line 1↵Line 2 (with line break)
- [ ] Type: 😀🎉 (emojis)

### ✅ Test 7: Complex Workflow
- [ ] AI creates a complete contact list (3+ entries)
- [ ] AI fills product information across multiple columns
- [ ] AI updates existing data based on criteria

---

## 🎯 Quick Test Prompts

Copy these prompts to test with the AI agent:

### Basic Input Test:
```
Type "Hello World" in cell A1 of the spreadsheet
```

### Header-Based Test:
```
In the Email column, row 2, enter "test@example.com"
```

### List Building Test:
```
Create a contact list with these 3 people:
1. John Doe, john@test.com, 555-1111
2. Jane Smith, jane@test.com, 555-2222  
3. Bob Wilson, bob@test.com, 555-3333
```

### Data Entry Test:
```
Add a new product to row 4:
- Product Name: "Super Widget"
- SKU: "SW-2024"
- Category: "Electronics"
- Price: "49.99"
- Quantity: "25"
```

### Update Test:
```
Find the row where Name is "John Doe" and update the Status to "Completed"
```

### Batch Test:
```
Fill the inventory sheet with 5 new items, each with:
- Item ID (1001-1005)
- Description (Widget 1, Widget 2, etc.)
- Stock Level (random between 10-100)
- Location (Warehouse A or B)
```

---

## 📊 Results Tracking

Add a new sheet called "Test Results" to track your testing:

```
Row 1 (Headers):
A1: Test Date
B1: Test Number
C1: Test Description
D1: Result (Pass/Fail)
E1: Time Taken
F1: Notes

Example Row:
A2: 2024-01-04
B2: Test 1
C2: Direct cell input to A5
D2: PASS
E2: 0.8 seconds
F2: Worked perfectly
```

---

## 🔧 Troubleshooting Space

Use Sheet 7 for debugging:

```
Row 1 (Headers):
A1: Issue
B1: Error Message
C1: Expected
D1: Actual
E1: Solution

Example:
A2: Cell not found
B2: "Could not navigate to B5"
C2: Value in B5
D2: Empty cell
E2: Cell was hidden, unhid column B
```

---

## 📥 Download Pre-Made Template

**Google Sheets Template**: 
- Create your own using the structure above
- Share it with edit permissions to test collaboration features

**Excel Online Template**:
- Create your own using the structure above
- Save to OneDrive for consistent access

---

## 🎉 Ready to Test!

Once you've set up your spreadsheet:

1. Load the Autoflow extension
2. Open the side panel
3. Navigate to your test spreadsheet
4. Try the test prompts above
5. Document results in the "Test Results" sheet
6. Report any issues with detailed logs

---

**Pro Tips**:
- Keep the console open (F12) to see detailed logs
- Test on both Google Sheets AND Excel Online
- Try both empty sheets and sheets with existing data
- Test with various zoom levels (50%, 100%, 150%)
- Test with frozen rows/columns
- Test with filtered data

---

**Last Updated**: January 2026

