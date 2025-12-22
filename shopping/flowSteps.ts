import { FlowStep, FlowStepName, ShoppingFlowConfig } from './types';

/**
 * Build the list of flow steps based on configuration
 */
export function buildFlowSteps(config: ShoppingFlowConfig): FlowStep[] {
  const steps: FlowStep[] = [
    createSearchStep(config.searchTerm),
    createResultsStep(config.productIndex ?? 0),
    createProductStep(config.quantity ?? 1),
    createCartStep(),
  ];

  if (config.completeCheckout) {
    steps.push(createCheckoutStep());
  }

  return steps;
}

/**
 * Step 1: Search - Find and use the search functionality
 */
function createSearchStep(searchTerm: string): FlowStep {
  return {
    name: 'search',
    goal: `You are on an e-commerce website homepage. Your task is to find the search input and search for "${searchTerm}". KEEP NAVIGATING FORWARD DON'T GO BACK. DISABLE SHIFT-TAB.

FIRST - Handle keyboard shortcuts modal (if present):
Some sites like Amazon show a "Keyboard shortcuts" modal when you first Tab into the page.
1. If you see a modal about keyboard shortcuts or accessibility features, press Escape to close it
2. If you see links like "Go to Search", "Skip to main content", etc. in the modal, press Escape instead of clicking them - they may not work as expected

THEN - Find the search input:
1. Press Tab to navigate through focusable elements
2. SKIP any combobox, listbox, or dropdown for "department" or "category" selection - these are NOT the search input
3. The actual search input is a TEXTBOX (not combobox) and will be announced as "Search" or "Search Amazon" etc.
4. If you land on a combobox with options like "All Departments", "Electronics", etc., press Tab again to move past it

Once you find the search TEXTBOX:
1. Type "${searchTerm}" using type_text
2. Press Enter or navigate 1 or 2 more to the search button to submit

Report success when you see search results for "${searchTerm}", or failure if you cannot find the search field.`,
    validations: [
      {
        type: 'keyboard_reachable',
        target: 'search input field',
        wcag: '2.1.1',
        severity: 'critical',
      },
      {
        type: 'has_label',
        target: 'search input field',
        wcag: '3.3.2',
        severity: 'serious',
      },
      {
        type: 'has_label',
        target: 'search submit button',
        wcag: '4.1.2',
        severity: 'serious',
      },
    ],
  };
}

/**
 * Step 2: Results - Navigate search results and select a product
 LOG:
FIRST - Skip the navigation (MANDATORY):
1. Press Tab once to focus the first element on the page
2. You should see a "Skip to main content" or "Skip to content" or "Results" link announced
3. If found, YOU MUST press Enter then YOU MUST keep navigating from there. DON'T refresh or go back
 */
function createResultsStep(productIndex: number): FlowStep {
  const productNumber = productIndex + 1;
  return {
    name: 'results',
    goal: `You are on a search results page. KEEP NAVIGATING FORWARD DON'T GO BACK. DISABLE SHIFT-TAB. Your task is to:

FIRST - Skip the navigation (MANDATORY):
1. Press Tab once to focus the first element on the page
2. You should see a "Skip to main content" or "Skip to content" link announced
3. IMMEDIATELY press Enter to activate this skip link, then IMMEDIATELY press Tab once or twice to enter main content area
4. Only if no skip link appears after 2-3 tabs, continue with regular navigation

THEN - Navigate search results:
4. Use screen reader navigation commands (arrow keys, Tab) to explore the results
5. Listen to what is announced for each product
6. Pay attention to how product images are described (alt text)
7. Browse through filter/sort controls if you encounter them (but don't get stuck on them)
8. Find and activate product #${productNumber} in the results

IMPORTANT: Be persistent! Shopping pages often have many elements before the products:
- You may need to navigate through 20-50+ elements to reach products
- Keep navigating even if you encounter many navigation items or ads

While navigating, note:
- Whether product images have meaningful alt text (not just "image" or "product photo")
- Whether product names and prices are clearly announced

Report success when you navigate to the product detail page. Only report failure after extensive navigation attempts (50+ elements) if products truly cannot be reached via keyboard.`,
    validations: [
      {
        type: 'alt_text_quality',
        target: 'product images in search results',
        wcag: '1.1.1',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'product links in results',
        wcag: '2.1.1',
        severity: 'critical',
      },
      {
        type: 'keyboard_reachable',
        target: 'filter and sort controls',
        wcag: '2.1.1',
        severity: 'moderate',
      },
      {
        type: 'heading_structure',
        target: 'product listing structure',
        wcag: '1.3.1',
        severity: 'moderate',
      },
    ],
  };
}

/**
 * Step 3: Product - Configure and add product to cart
 */
function createProductStep(quantity: number): FlowStep {
  const quantityInstruction = quantity > 1
    ? `set the quantity to ${quantity}`
    : 'leave the quantity at 1 (or verify default is 1)';

  return {
    name: 'product',
    goal: `You are on a product detail page. DISABLE SHIFT-TAB. Your task is to add to cart the current product:

FIRST - Skip the navigation:
1. Press Tab once to focus the first element on the page
2. You should see a "Skip to main content" or "Skip to content" link announced
3. IMMEDIATELY press Enter to activate this skip link, then IMMEDIATELY press Tab once or twice to enter main content area
4. Only if no skip link appears after 2-3 tabs, continue with regular navigation

THEN - Navigate to the "Add to Cart" button:
1. Navigate through the product page using screen reader commands
2. Listen to product image descriptions (alt text) - are they meaningful?
3. Find product options (like size, color) if they exist and check if they're keyboard accessible
4. Find the quantity selector and ${quantityInstruction}
5. Find and activate the "Add to Cart" button
6. After clicking Add to Cart, listen for any status announcement (aria-live)

WHILE navigating, note:
- Quality of product image alt text (should describe the product, not just "product image")
- Whether size/color selectors are keyboard accessible
- Whether quantity can be changed via keyboard
- What is announced after adding to cart (confirmation message?)

Report success when the item is added to cart (look for confirmation or cart update). Only report failure after extensive navigation attempts (50+ elements) if you truly cannot complete the add-to-cart action.`,
    validations: [
      {
        type: 'alt_text_quality',
        target: 'product gallery images',
        wcag: '1.1.1',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'product variant options (size, color)',
        wcag: '2.1.1',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'quantity selector',
        wcag: '2.1.1',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'add to cart button',
        wcag: '2.1.1',
        severity: 'critical',
      },
      {
        type: 'aria_live',
        target: 'cart update confirmation after add to cart',
        wcag: '4.1.3',
        severity: 'serious',
      },
    ],
  };
}

/**
 * Step 4: Cart - Review cart and proceed to checkout
 */
function createCartStep(): FlowStep {
  return {
    name: 'cart',
    goal: `Your task is to navigate to the shopping cart and proceed to checkout:

1. Find and navigate to the cart (look for cart icon, "Cart", "Bag", or similar)
2. Once in the cart, verify the cart contents are accessible via screen reader
3. Check if you can update quantity or remove items via keyboard
4. Find and activate the "Checkout" or "Proceed to Checkout" button

While navigating, note:
- Whether cart link/icon is keyboard accessible
- Whether cart contents are clearly announced (product name, quantity, price)
- Whether quantity update and remove controls are keyboard accessible
- Whether checkout button is reachable and properly labeled

If checkout requires login, report this as the stopping point and note that login is required.

Report success when you reach the checkout page, or note if login is required.`,
    validations: [
      {
        type: 'keyboard_reachable',
        target: 'cart link or icon',
        wcag: '2.1.1',
        severity: 'critical',
      },
      {
        type: 'keyboard_reachable',
        target: 'quantity update controls in cart',
        wcag: '2.1.1',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'remove item controls in cart',
        wcag: '2.1.1',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'checkout/proceed button',
        wcag: '2.1.1',
        severity: 'critical',
      },
      {
        type: 'has_label',
        target: 'cart item details (name, price, quantity)',
        wcag: '1.3.1',
        severity: 'moderate',
      },
    ],
  };
}

/**
 * Step 5: Checkout - Test checkout form accessibility
 */
function createCheckoutStep(): FlowStep {
  return {
    name: 'checkout',
    goal: `You are on the checkout page. Your task is to test form accessibility:

1. Navigate through all form fields using Tab
2. For each field, note what the screen reader announces (label, required status, format hints)
3. Check if error messages are announced when you try to submit with empty required fields
4. Verify focus is visible on each form field
5. Check if the form can be submitted via keyboard (Enter on submit button)

DO NOT enter real payment information - just test the form accessibility.

While navigating, note:
- Whether all form fields have proper labels
- Whether required fields are indicated accessibly (not just by color)
- Whether input format hints are provided (e.g., "MM/YY" for card expiry)
- Whether error messages are announced via screen reader
- Whether focus indicator is visible

Report your findings about checkout form accessibility. If login is required, report that and stop.`,
    validations: [
      {
        type: 'has_label',
        target: 'all checkout form fields',
        wcag: '3.3.2',
        severity: 'critical',
      },
      {
        type: 'focus_visible',
        target: 'form fields and buttons',
        wcag: '2.4.7',
        severity: 'serious',
      },
      {
        type: 'keyboard_reachable',
        target: 'all form fields in logical order',
        wcag: '2.4.3',
        severity: 'critical',
      },
      {
        type: 'aria_live',
        target: 'form validation error messages',
        wcag: '3.3.1',
        severity: 'serious',
      },
    ],
  };
}

/**
 * Get a human-readable description of a flow step
 */
export function getStepDescription(stepName: FlowStepName): string {
  const descriptions: Record<FlowStepName, string> = {
    search: 'Search for products',
    results: 'Navigate search results',
    product: 'View product and add to cart',
    cart: 'Review cart and proceed to checkout',
    checkout: 'Complete checkout form',
  };
  return descriptions[stepName];
}
