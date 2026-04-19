variable "db_admin_password" {
  sensitive = true
}

# --- 1. DEFINE THE SECRETS WE ARE EXPECTING ---
variable "tenancy_ocid" {}
variable "user_ocid" {}
variable "fingerprint" {}
variable "region" {}
variable "private_key" {
  sensitive = true
}

# --- 2. THE PROVIDER (Telling Terraform we are using Oracle) ---
provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  region           = var.region
  private_key  = var.private_key
}

# --- 3. THE HANDSHAKE (Ask Oracle for a list of Data Centers) ---
data "oci_identity_availability_domains" "ad_list" {
  compartment_id = var.tenancy_ocid
}

# --- 4. PRINT THE RESULT TO THE SCREEN ---
output "success_message" {
  value = "Handshake Successful! Here are your Oracle Data Centers: ${data.oci_identity_availability_domains.ad_list.availability_domains[0].name}"
}

# --- 5. OUR LIVE KUBERNETES SERVER ---
resource "oci_core_instance" "k8s_server" {
  availability_domain = "YlYw:AP-KULAI-2-AD-1"
  compartment_id      = var.tenancy_ocid
  display_name        = "instance-20260330-1757"
  shape               = "VM.Standard.A1.Flex"

  freeform_tags = {
    "ManagedBy"   = "Terraform"
    "Project"     = "Cats-vs-Dogs-Live"
    "Environment" = "Production"
  }

  shape_config {
    ocpus         = 1
    memory_in_gbs = 6
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.k8s_subnet.id
    assign_public_ip = true
    nsg_ids          = ["ocid1.networksecuritygroup.oc1.ap-kulai-2.aaaaaaaazo3el34bwtm247cnevhyv7njta6gai3pt46fegmdxwu6x7rqdseq"]
  }

  source_details {
    source_id               = "ocid1.image.oc1.ap-kulai-2.aaaaaaaaxabtyo26yvpsihvqenlko5fadwhm7trqmb2hyaswsmdec66n4yfq"
    source_type             = "image"
    boot_volume_size_in_gbs = "47"
  }

  metadata = {
    "ssh_authorized_keys" = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCqNN6YH1gfZsx/HUwLMnxHKBM/AvBPfrUQ43rIGzDED12ieqkiKpJF7/MVy2UcpFROnmQJ33+kgMqcia3xzuI2B6k0HbguGvOXUTCNF27Slw52Rj8ebBn2SGQqIZJCTiYocfMRj1mlEj4AipujYs+kcocLD3Hn+Fax+XJwqyj1wEMXrrmbGG0Hqd9PQtNoPJWjSOmYQUzQ1f2/pwoWShNmREMLIYjRBS/v53O2qhXXCOsHoV7gahV8tGK6qHxHTGswYoVJji4Yyv+Jpv2thgB+80zX9i1LjvaiVtdze4t0FX+qo5OaU5e2jxWnmfHIQhbGk7KFTuELVNldYpb7IKg/ ssh-key-2026-03-30"
  }
}


# --- 6. OUR LIVE NETWORK (VCN) ---
resource "oci_core_vcn" "k8s_vcn" {
  compartment_id = var.tenancy_ocid  # <--- Clean Code Magic!
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "vcn-20260330-1801"
  dns_label      = "vcn03301803"
}

# --- 7. OUR LIVE SUBNET ---
resource "oci_core_subnet" "k8s_subnet" {
 compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.k8s_vcn.id # <--- Clean Code: Linking directly to the VCN!
  cidr_block     = "10.0.0.0/24"
  display_name   = "subnet-20260330-1801"
  dns_label      = "subnet03301803"

  # Clean Code: Using the VCN's default routing and security lists automatically
  route_table_id    = oci_core_vcn.k8s_vcn.default_route_table_id
  dhcp_options_id   = oci_core_vcn.k8s_vcn.default_dhcp_options_id
  security_list_ids = [oci_core_vcn.k8s_vcn.default_security_list_id]
}

# --- 8. OUR LIVE FIREWALL (SECURITY LIST) ---
resource "oci_core_security_list" "k8s_security_list" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.k8s_vcn.id # <--- Clean Code: Linked to your VCN
  display_name   = "Default Security List for vcn-20260330-1801"

  # --- OUTBOUND TRAFFIC (Allow everything to leave the server) ---
  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
    stateless        = false
  }

  # --- INBOUND TRAFFIC (The Gates) ---
  
  # 1. ICMP (Ping Requests/Replies)
  ingress_security_rules {
    protocol    = "1"
    source      = "10.0.0.0/16"
    source_type = "CIDR_BLOCK"
    stateless   = false
    icmp_options {
      type = 3
      code = -1
    }
  }
  ingress_security_rules {
    protocol    = "1"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    icmp_options {
      type = 3
      code = 4
    }
  }

  # 2. SSH (Port 22 for Terminal Access)
  ingress_security_rules {
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    tcp_options {
      min = 22
      max = 22
    }
  }

  # 3. HTTP (Port 80 for Web Traffic)
  ingress_security_rules {
    description = "For Web Traffic (HTTP)"
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    tcp_options {
      min = 80
      max = 80
    }
  }

  # 4. HTTPS (Port 443 for Secure Web Traffic)
  ingress_security_rules {
    description = "For Secure Web Traffic (HTTPS)"
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    tcp_options {
      min = 443
      max = 443
    }
  }

  # 5. Kubernetes API (Port 6443)
  ingress_security_rules {
    description = "This is for the Kubernetes API"
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    tcp_options {
      min = 6443
      max = 6443
    }
  }

  # 6. NodePort (Port 31886)
  ingress_security_rules {
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    tcp_options {
      min = 31886
      max = 31886
    }
  }
}


# # --- 9. THE DATA FORTRESS (AUTONOMOUS DATABASE) ---
# resource "oci_database_autonomous_database" "k8s_database" {
#   compartment_id           = var.tenancy_ocid
#   db_name                  = "catsdogsdb"
#   display_name             = "Cats-Vs-Dogs-DB"
#   admin_password           = var.db_admin_password
#   is_free_tier             = true
#   is_mtls_connection_required = true # <--- The Security Promise
# }

# --- 10. THE BRAIN VAULT (OBJECT STORAGE BUCKET) ---

# Step A: Ask Oracle for your account's unique storage namespace
data "oci_objectstorage_namespace" "user_namespace" {
  compartment_id = var.tenancy_ocid
}

# Step B: Create the highly secure bucket
resource "oci_objectstorage_bucket" "terraform_state_bucket" {
  compartment_id = var.tenancy_ocid
  name           = "cats-vs-dogs-tf-state"
  namespace      = data.oci_objectstorage_namespace.user_namespace.namespace
  
  # Security Rules: Completely private, and keep backups of every change!
  access_type    = "NoPublicAccess"
  versioning     = "Enabled" 
}

terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 4.0.0"
    }
  }
  
  # --- THE MIND UPLOAD ---
  backend "http" {
    update_method = "PUT"
    address       = "https://objectstorage.ap-kulai-2.oraclecloud.com/p/MCCZb_S11lxngGFam7XR8ZsbHATLlr3H6_A_hOARfK-8ktynyouMWihgfbgpx-Mw/n/axvb5wrms5km/b/cats-vs-dogs-tf-state/o/terraform.tfstate"
  }
}